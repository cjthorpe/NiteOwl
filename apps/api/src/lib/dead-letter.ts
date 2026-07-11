// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Dead-letter handling and alerting for BullMQ jobs (FUL-131).
 *
 * BullMQ fires a worker's `failed` event on *every* failed attempt, including
 * the transient ones that will be retried. When the final attempt fails the job
 * is moved to the queue's `failed` set — that retained set (bounded by each
 * queue's `removeOnFail` option) IS the dead-letter store: exhausted jobs stay
 * inspectable and re-drivable via the BullMQ API (`queue.getFailed()`, Bull
 * Board, etc.). We deliberately do NOT stand up a separate physical DLQ queue —
 * the failed set already provides durable retention; what was missing was
 * *visibility*.
 *
 * This module supplies that visibility: `attachDeadLetterHandler` registers a
 * `failed` listener that detects exhaustion, bumps `bullmq_dead_letter_total`,
 * and fires a Slack alert. It mirrors `metrics.ts`/`slack-alert.ts` and has no
 * Fastify dependency so any worker can wire it in with a single call.
 */

import type { Worker } from 'bullmq';

import { bullmqDeadLetterTotal } from './metrics.js';
import { formatDeadLetterAlert, sendSlackAlert, type DeadLetterAlertData } from './slack-alert.js';

// ---------------------------------------------------------------------------
// Exhaustion predicate
// ---------------------------------------------------------------------------

/**
 * The minimal BullMQ `Job` surface we need to decide whether a failed job has
 * exhausted its retries. Kept structural so callers (and tests) don't need a
 * full `Job` instance.
 */
export interface ExhaustibleJob {
  attemptsMade: number;
  opts: { attempts?: number };
}

/**
 * True when a failed job has used up every configured attempt and BullMQ has
 * therefore moved it to the failed (dead-letter) set.
 *
 * `attempts` defaults to 1 when unset — a job with no retry policy is exhausted
 * the moment its single attempt fails.
 */
export function isExhausted(job: ExhaustibleJob | undefined): boolean {
  if (!job) return false;
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}

// ---------------------------------------------------------------------------
// Reporting (counter + alert)
// ---------------------------------------------------------------------------

/** Structured logger surface (pino `request.log` or a `console`-shim). */
export interface DeadLetterLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ReportDeadLetterInput {
  queue: string;
  jobId?: string | undefined;
  jobName: string;
  attemptsMade: number;
  failedReason: string;
}

export interface ReportDeadLetterDeps {
  webhookUrl?: string | undefined;
  now?: () => Date;
  logger?: DeadLetterLogger;
  /** Injectable for tests; defaults to the real Slack sender. */
  send?: typeof sendSlackAlert;
}

export interface DeadLetterOutcome {
  /** True when a Slack alert was actually dispatched. */
  alertSent: boolean;
}

/**
 * Records a dead-lettered job: always bumps `bullmq_dead_letter_total{queue}`,
 * then fires a Slack alert when a webhook is configured.
 *
 * The alert is gated on `SLACK_ALERT_WEBHOOK_URL`: when the webhook is unset the
 * function no-ops cleanly (the counter still increments). Slack delivery
 * failures are swallowed and logged — alerting must never crash the worker.
 */
export async function reportDeadLetter(
  input: ReportDeadLetterInput,
  deps: ReportDeadLetterDeps = {},
): Promise<DeadLetterOutcome> {
  bullmqDeadLetterTotal.inc({ queue: input.queue }, 1);

  const webhookUrl = deps.webhookUrl ?? process.env['SLACK_ALERT_WEBHOOK_URL'];
  if (!webhookUrl) {
    return { alertSent: false };
  }

  const occurredAt = (deps.now?.() ?? new Date()).toISOString();
  const alert: DeadLetterAlertData = {
    queue: input.queue,
    jobName: input.jobName,
    attemptsMade: input.attemptsMade,
    failedReason: input.failedReason,
    occurredAt,
    ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
  };

  try {
    const send = deps.send ?? sendSlackAlert;
    await send(webhookUrl, formatDeadLetterAlert(alert));
    return { alertSent: true };
  } catch (err) {
    deps.logger?.error(
      {
        queue: input.queue,
        jobId: input.jobId,
        err: err instanceof Error ? err.message : String(err),
      },
      '[dead-letter] Slack alert delivery failed',
    );
    return { alertSent: false };
  }
}

// ---------------------------------------------------------------------------
// Worker wiring
// ---------------------------------------------------------------------------

/**
 * Registers a `failed` listener on `worker` that reports only *exhausted* jobs
 * as dead letters. Non-final failures (which BullMQ will retry) are ignored so
 * the alert fires exactly once per job, at exhaustion.
 *
 * BullMQ allows multiple `failed` listeners, so this composes with a worker's
 * existing per-attempt logging handler rather than replacing it.
 */
export function attachDeadLetterHandler<T>(
  worker: Worker<T>,
  queue: string,
  deps: ReportDeadLetterDeps = {},
): void {
  worker.on('failed', (job, err) => {
    if (!isExhausted(job)) return;
    void reportDeadLetter(
      {
        queue,
        jobId: job?.id,
        jobName: job?.name ?? 'unknown',
        attemptsMade: job?.attemptsMade ?? 0,
        failedReason: err?.message ?? 'unknown error',
      },
      deps,
    );
  });
}
