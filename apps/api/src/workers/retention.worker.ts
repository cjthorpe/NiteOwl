// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * BullMQ worker for the event-retention sweep (FUL-132).
 *
 * Fires once per day (default 04:00 UTC, configurable via RETENTION_HOUR_UTC —
 * deliberately offset from the overnight catch-up at 06:00 so the two nightly
 * jobs don't contend) and deletes expired rows from `activity_events` and
 * `webhook_events` per the window resolved from the environment.
 *
 * Failure policy:
 *  - The two table sweeps are independent within `runEventRetention`; a failure
 *    surfaces as a job failure and BullMQ retries up to the configured attempt
 *    limit. Because deletion is idempotent (already-deleted rows simply aren't
 *    re-matched), retries are safe.
 *
 * Observability:
 *  - Deleted counts + cutoffs are logged at info level, and a disabled window is
 *    logged so an operator can see retention is intentionally off rather than
 *    silently broken.
 */

import type { Db } from '@niteowl/db';
import { Worker } from 'bullmq';

import { resolveRetentionConfig, runEventRetention } from '../lib/event-retention.js';

// ---------------------------------------------------------------------------
// Queue name + job data type
// ---------------------------------------------------------------------------

export const EVENT_RETENTION_QUEUE = 'event-retention';

/** No per-job input — the window is resolved from the environment at run time. */
export type EventRetentionJobData = Record<string, never>;

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates and starts the BullMQ event-retention worker.
 *
 * Concurrency is 1: the sweep runs nightly and issues at most two DELETE
 * statements, so there is no benefit to parallelism.
 *
 * @param db           Drizzle DB client.
 * @param redisOptions Redis connection options (host + port).
 */
export function createRetentionWorker(
  db: Db,
  redisOptions: { host: string; port: number },
): Worker<EventRetentionJobData> {
  const worker = new Worker<EventRetentionJobData>(
    EVENT_RETENTION_QUEUE,
    async (job) => {
      const label = `[event-retention] job ${job.id ?? '?'}`;
      const config = resolveRetentionConfig();

      if (config.activityEventsRetentionDays === 0 && config.webhookEventsRetentionDays === 0) {
        console.info(`${label} skipped — retention disabled for both tables`);
        return;
      }

      const result = await runEventRetention(db, config);

      console.info(
        `${label} complete — ` +
          `activity_events deleted=${result.activityEventsDeleted} ` +
          `cutoff=${result.activityCutoff?.toISOString() ?? 'disabled'} ` +
          `webhook_events deleted=${result.webhookEventsDeleted} ` +
          `cutoff=${result.webhookCutoff?.toISOString() ?? 'disabled'}`,
      );
    },
    {
      connection: redisOptions,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[event-retention] job ${job?.id ?? 'unknown'} failed`, { error: err.message });
  });

  worker.on('completed', (job) => {
    console.info(`[event-retention] job ${job.id ?? ''} completed`);
  });

  return worker;
}
