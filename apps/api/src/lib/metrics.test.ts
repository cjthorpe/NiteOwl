// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ingestionErrorsTotal,
  ingestionFetchedTotal,
  ingestionInsertedTotal,
  ingestionLagSeconds,
  ingestionQueueDepth,
  ingestionRunDurationSeconds,
  ingestionSilentFailuresTotal,
  isSilentFailure,
  register,
  reportIngestionRun,
  setIngestionLag,
  setQueueDepth,
  timeSpan,
} from './metrics.js';

// prom-client metrics are process-global singletons on `register`; reset them
// before each test so counter assertions are independent.
beforeEach(() => {
  register.resetMetrics();
});

async function counterValue(
  metric: typeof ingestionFetchedTotal,
  labels: { provider: string; source: string },
): Promise<number> {
  const { values } = await metric.get();
  const match = values.find(
    (v) => v.labels['provider'] === labels.provider && v.labels['source'] === labels.source,
  );
  return match?.value ?? 0;
}

describe('isSilentFailure', () => {
  it('is true only when items were fetched but none inserted', () => {
    expect(isSilentFailure(405, 0)).toBe(true);
  });

  it('is false when nothing was fetched', () => {
    expect(isSilentFailure(0, 0)).toBe(false);
  });

  it('is false when at least one row was inserted', () => {
    expect(isSilentFailure(10, 3)).toBe(false);
    expect(isSilentFailure(10, 10)).toBe(false);
  });
});

describe('reportIngestionRun — counters', () => {
  it('increments fetched/inserted/errors by the reported amounts', async () => {
    await reportIngestionRun({
      provider: 'github',
      source: 'repo_scan',
      fetched: 12,
      inserted: 9,
      errors: 2,
    });

    const labels = { provider: 'github', source: 'repo_scan' };
    expect(await counterValue(ingestionFetchedTotal, labels)).toBe(12);
    expect(await counterValue(ingestionInsertedTotal, labels)).toBe(9);
    expect(await counterValue(ingestionErrorsTotal, labels)).toBe(2);
    // A healthy run must not touch the silent-failure counter.
    expect(await counterValue(ingestionSilentFailuresTotal, labels)).toBe(0);
  });
});

describe('reportIngestionRun — silent-failure boundary (FUL-98/FUL-145)', () => {
  it('fires the alert and bumps the counter when fetched>0 && inserted==0', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, attempts: 1 });

    const outcome = await reportIngestionRun(
      { provider: 'github', source: 'repo_scan', fetched: 405, inserted: 0, traceId: 't-1' },
      { webhookUrl: 'https://hooks.slack.test/x', send },
    );

    expect(outcome).toEqual({ silentFailure: true, alertSent: true });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, message] = send.mock.calls[0]!;
    expect(url).toBe('https://hooks.slack.test/x');
    expect(message.text).toContain('Silent ingestion failure');
    expect(
      await counterValue(ingestionSilentFailuresTotal, { provider: 'github', source: 'repo_scan' }),
    ).toBe(1);
  });

  it('does NOT fire when fetched==0 (nothing to do)', async () => {
    const send = vi.fn();
    const outcome = await reportIngestionRun(
      { provider: 'linear', source: 'catchup', fetched: 0, inserted: 0 },
      { webhookUrl: 'https://hooks.slack.test/x', send },
    );
    expect(outcome.silentFailure).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT fire when inserted>0 (rows landed)', async () => {
    const send = vi.fn();
    const outcome = await reportIngestionRun(
      { provider: 'linear', source: 'catchup', fetched: 8, inserted: 8 },
      { webhookUrl: 'https://hooks.slack.test/x', send },
    );
    expect(outcome.silentFailure).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('bumps the counter but no-ops the alert when the webhook is unset', async () => {
    const send = vi.fn();
    const outcome = await reportIngestionRun(
      { provider: 'jira', source: 'catchup', fetched: 3, inserted: 0 },
      { webhookUrl: undefined, send },
    );
    expect(outcome).toEqual({ silentFailure: true, alertSent: false });
    expect(send).not.toHaveBeenCalled();
    expect(
      await counterValue(ingestionSilentFailuresTotal, { provider: 'jira', source: 'catchup' }),
    ).toBe(1);
  });

  it('swallows a Slack delivery failure (observability never breaks ingestion)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('slack 500'));
    const outcome = await reportIngestionRun(
      { provider: 'github', source: 'post_login', fetched: 5, inserted: 0 },
      { webhookUrl: 'https://hooks.slack.test/x', send },
    );
    expect(outcome).toEqual({ silentFailure: true, alertSent: false });
  });
});

describe('timeSpan', () => {
  it('records the duration histogram and returns the wrapped value', async () => {
    let clock = 1000;
    const result = await timeSpan(
      { name: 'github.repo_scan', provider: 'github', source: 'repo_scan', now: () => clock },
      async () => {
        clock += 2500; // simulate 2.5s of work
        return 'done';
      },
    );

    expect(result).toBe('done');
    const { values } = await ingestionRunDurationSeconds.get();
    const sum = values.find(
      (v) =>
        v.metricName === 'ingestion_run_duration_seconds_sum' && v.labels['provider'] === 'github',
    );
    expect(sum?.value).toBeCloseTo(2.5, 3);
  });

  it('still records the histogram when the wrapped fn throws', async () => {
    let clock = 0;
    await expect(
      timeSpan(
        { name: 'linear.catchup', provider: 'linear', source: 'catchup', now: () => clock },
        async () => {
          clock += 1000;
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    const { values } = await ingestionRunDurationSeconds.get();
    const count = values.find(
      (v) =>
        v.metricName === 'ingestion_run_duration_seconds_count' &&
        v.labels['provider'] === 'linear',
    );
    expect(count?.value).toBe(1);
  });
});

describe('setIngestionLag', () => {
  it('computes seconds since the last ingested_at', async () => {
    const now = new Date('2026-07-06T12:00:00Z').getTime();
    setIngestionLag(new Date('2026-07-06T11:59:00Z'), () => now);
    const { values } = await ingestionLagSeconds.get();
    expect(values[0]?.value).toBe(60);
  });

  it('resets to 0 when there are no events', async () => {
    setIngestionLag(null);
    const { values } = await ingestionLagSeconds.get();
    expect(values[0]?.value).toBe(0);
  });
});

describe('setQueueDepth', () => {
  it('sets a gauge per job state', async () => {
    setQueueDepth('overnight-catchup', { waiting: 3, active: 1, failed: 0 });
    const { values } = await ingestionQueueDepth.get();
    const waiting = values.find(
      (v) => v.labels['queue'] === 'overnight-catchup' && v.labels['state'] === 'waiting',
    );
    expect(waiting?.value).toBe(3);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
