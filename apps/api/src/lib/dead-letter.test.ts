// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Worker } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachDeadLetterHandler, isExhausted, reportDeadLetter } from './dead-letter.js';
import { bullmqDeadLetterTotal, register } from './metrics.js';

// prom-client counters are process-global singletons; reset before each test so
// assertions are independent.
beforeEach(() => {
  register.resetMetrics();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['SLACK_ALERT_WEBHOOK_URL'];
});

async function deadLetterCount(queue: string): Promise<number> {
  const { values } = await bullmqDeadLetterTotal.get();
  return values.find((v) => v.labels['queue'] === queue)?.value ?? 0;
}

/** Flush the microtask queue so a `void reportDeadLetter(...)` call settles. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('isExhausted', () => {
  it('is false for an undefined job', () => {
    expect(isExhausted(undefined)).toBe(false);
  });

  it('is false while retries remain', () => {
    expect(isExhausted({ attemptsMade: 2, opts: { attempts: 5 } })).toBe(false);
  });

  it('is true once the final attempt has been made', () => {
    expect(isExhausted({ attemptsMade: 5, opts: { attempts: 5 } })).toBe(true);
  });

  it('is true if attemptsMade somehow exceeds the configured max', () => {
    expect(isExhausted({ attemptsMade: 6, opts: { attempts: 5 } })).toBe(true);
  });

  it('defaults attempts to 1 when unset (single-shot jobs)', () => {
    expect(isExhausted({ attemptsMade: 0, opts: {} })).toBe(false);
    expect(isExhausted({ attemptsMade: 1, opts: {} })).toBe(true);
  });
});

describe('reportDeadLetter — counter', () => {
  it('increments bullmq_dead_letter_total for the queue', async () => {
    await reportDeadLetter({
      queue: 'normalization',
      jobName: 'run',
      attemptsMade: 5,
      failedReason: 'boom',
    });
    expect(await deadLetterCount('normalization')).toBe(1);
    expect(await deadLetterCount('slack-alert')).toBe(0);
  });

  it('increments even when no webhook is configured (alert skipped)', async () => {
    const outcome = await reportDeadLetter({
      queue: 'slack-alert',
      jobName: 'send-pr-merge-alert',
      attemptsMade: 4,
      failedReason: 'webhook 500',
    });
    expect(outcome.alertSent).toBe(false);
    expect(await deadLetterCount('slack-alert')).toBe(1);
  });
});

describe('reportDeadLetter — alerting', () => {
  it('sends a Slack alert when a webhook is configured', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, attempts: 1 });
    const outcome = await reportDeadLetter(
      {
        queue: 'normalization',
        jobId: '42',
        jobName: 'run',
        attemptsMade: 5,
        failedReason: 'insert failed',
      },
      { webhookUrl: 'https://hooks.slack.test/x', send },
    );

    expect(outcome.alertSent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, message] = send.mock.calls[0]!;
    expect(url).toBe('https://hooks.slack.test/x');
    expect(message.text).toContain('normalization');
    expect(message.text).toContain('insert failed');
  });

  it('reads the webhook from SLACK_ALERT_WEBHOOK_URL when not passed', async () => {
    process.env['SLACK_ALERT_WEBHOOK_URL'] = 'https://hooks.slack.test/env';
    const send = vi.fn().mockResolvedValue({ ok: true, attempts: 1 });
    const outcome = await reportDeadLetter(
      { queue: 'overnight-catchup', jobName: 'run', attemptsMade: 3, failedReason: 'timeout' },
      { send },
    );
    expect(outcome.alertSent).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('swallows and logs Slack delivery failures (counter still bumped)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'));
    const logger = { error: vi.fn() };
    const outcome = await reportDeadLetter(
      { queue: 'normalization', jobName: 'run', attemptsMade: 5, failedReason: 'boom' },
      { webhookUrl: 'https://hooks.slack.test/x', send, logger },
    );

    expect(outcome.alertSent).toBe(false);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(await deadLetterCount('normalization')).toBe(1);
  });
});

// Minimal Worker stub that captures the `failed` listener.
function stubWorker(): {
  worker: Worker<unknown>;
  fire: (job: unknown, err: Error) => void;
} {
  let handler: ((job: unknown, err: Error) => void) | undefined;
  const worker = {
    on: (event: string, cb: (job: unknown, err: Error) => void) => {
      if (event === 'failed') handler = cb;
    },
  } as unknown as Worker<unknown>;
  return {
    worker,
    fire: (job, err) => handler?.(job, err),
  };
}

describe('attachDeadLetterHandler', () => {
  it('ignores non-exhausted (retryable) failures', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, attempts: 1 });
    const { worker, fire } = stubWorker();
    attachDeadLetterHandler(worker, 'normalization', {
      webhookUrl: 'https://hooks.slack.test/x',
      send,
    });

    fire({ id: '1', name: 'run', attemptsMade: 2, opts: { attempts: 5 } }, new Error('transient'));
    await flush();

    expect(send).not.toHaveBeenCalled();
    expect(await deadLetterCount('normalization')).toBe(0);
  });

  it('reports exhausted jobs exactly once', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, attempts: 1 });
    const { worker, fire } = stubWorker();
    attachDeadLetterHandler(worker, 'slack-alert', {
      webhookUrl: 'https://hooks.slack.test/x',
      send,
    });

    fire(
      { id: '7', name: 'send-pr-merge-alert', attemptsMade: 4, opts: { attempts: 4 } },
      new Error('gone'),
    );
    await flush();

    expect(send).toHaveBeenCalledOnce();
    expect(await deadLetterCount('slack-alert')).toBe(1);
  });
});
