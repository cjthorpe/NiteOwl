import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { Queue } from "bullmq";

import type { Db } from "@niteowl/db";
import type { NormalizationJobData, SlackAlertJobData } from "@niteowl/types";
import {
  NORMALIZATION_QUEUE,
  createNormalizationWorker,
} from "../workers/normalization.worker.js";
import {
  SLACK_ALERT_QUEUE,
  createSlackAlertWorker,
} from "../workers/slack-alert.worker.js";
import {
  OVERNIGHT_CATCHUP_QUEUE,
  createOvernightCatchupWorker,
  type OvernightCatchupJobData,
} from "../workers/overnight-catchup.worker.js";

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    normalizationQueue: Queue<NormalizationJobData> | null;
    slackAlertQueue: Queue<SlackAlertJobData> | null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRedisUrl(rawUrl: string): { host: string; port: number } {
  try {
    const url = new URL(rawUrl);
    return {
      host: url.hostname || "localhost",
      port: Number(url.port) || 6379,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

/**
 * Computes the UTC hour at which the overnight catch-up should fire.
 *
 * Reads `CATCHUP_HOUR_UTC` from the environment (default: 6 → 06:00 UTC).
 * Values outside [0, 23] fall back to the default.
 */
function parseCatchupHour(): number {
  const raw = process.env["CATCHUP_HOUR_UTC"];
  if (!raw) return 6;
  const parsed = parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface QueuePluginOptions {
  db: Db;
}

/**
 * Registers all BullMQ queues, workers, and job schedulers.
 *
 * Normalization queue defaults:
 *  - 5 attempts with exponential back-off (1 s → 2 s → 4 s → 8 s → 16 s)
 *  - Completed jobs retained for the last 1 000 entries (audit log)
 *  - Failed jobs retained for the last 5 000 entries (dead-letter store)
 *
 * Slack-alert queue defaults (FUL-34):
 *  - 4 attempts (1 initial + 3 retries)
 *  - Fixed 60-second delay between each retry
 *  - Completed jobs retained for the last 500 entries
 *  - Failed jobs retained for the last 1 000 entries
 *
 * Overnight catch-up queue (FUL-60):
 *  - Repeating job registered at startup via upsertJobScheduler (idempotent)
 *  - Fires daily at CATCHUP_HOUR_UTC:00 UTC (default 06:00)
 *  - 3 attempts with fixed 5-minute delay between retries
 *  - Completed jobs retained for the last 30 entries (one month at daily cadence)
 *  - Failed jobs retained for the last 90 entries
 *
 * All queues are exposed on the Fastify instance where routes need to enqueue
 * jobs. A null value indicates Redis was unavailable at startup — handlers must
 * treat this gracefully.
 */
const queuePlugin: FastifyPluginAsync<QueuePluginOptions> = async (
  fastify,
  { db },
) => {
  const redisUrl =
    process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const redisOptions = parseRedisUrl(redisUrl);

  // ── Normalization queue ───────────────────────────────────────────────────
  const normalizationJobDefaults = {
    attempts: 5,
    backoff: {
      type: "exponential" as const,
      delay: 1000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  };

  const normalizationQueue = new Queue<NormalizationJobData>(
    NORMALIZATION_QUEUE,
    {
      connection: redisOptions,
      defaultJobOptions: normalizationJobDefaults,
    },
  );

  // ── Slack-alert queue (FUL-34) ────────────────────────────────────────────
  // 3 retries with a fixed 60-second delay between each attempt so transient
  // Slack outages (< 3 min) are automatically recovered.
  const slackAlertJobDefaults = {
    attempts: 4, // 1 initial + 3 retries
    backoff: {
      type: "fixed" as const,
      delay: 60_000, // 1 minute
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  };

  const slackAlertQueue = new Queue<SlackAlertJobData>(SLACK_ALERT_QUEUE, {
    connection: redisOptions,
    defaultJobOptions: slackAlertJobDefaults,
  });

  // ── Overnight catch-up queue (FUL-60) ────────────────────────────────────
  // Retried up to 3 times with a 5-minute fixed delay so a transient network
  // hiccup at the scheduled hour doesn't skip the entire daily catch-up.
  const overnightCatchupQueue = new Queue<OvernightCatchupJobData>(
    OVERNIGHT_CATCHUP_QUEUE,
    {
      connection: redisOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "fixed" as const, delay: 5 * 60_000 }, // 5 min
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 90 },
      },
    },
  );

  // Register (or update) the daily repeating scheduler.
  // upsertJobScheduler is idempotent: re-registering on every startup with the
  // same schedulerId is safe — BullMQ de-duplicates by key and only reschedules
  // when the pattern changes.
  const catchupHour = parseCatchupHour();
  const cronPattern = `0 ${catchupHour} * * *`;

  // Register the daily scheduler asynchronously so a Redis connection hiccup
  // at startup does not block the rest of the app.  In production Redis is
  // available and the call resolves almost immediately; in test environments
  // without Redis the error is logged and the scheduler self-heals on the next
  // healthy startup (upsertJobScheduler is idempotent).
  void overnightCatchupQueue
    .upsertJobScheduler(
      "overnight-catchup-daily",
      { pattern: cronPattern },
      { name: "run", data: {} },
    )
    .then(() => {
      fastify.log.info(
        { cronPattern, catchupHour },
        "[overnight-catchup] daily scheduler registered",
      );
    })
    .catch((err: unknown) => {
      fastify.log.error(
        { err, cronPattern },
        "[overnight-catchup] scheduler registration failed — will retry on next healthy startup",
      );
    });

  // ── Workers ───────────────────────────────────────────────────────────────

  const normalizationWorker = createNormalizationWorker(
    db,
    redisOptions,
    slackAlertQueue,
  );

  const slackAlertWorker = createSlackAlertWorker(db, redisOptions);

  const overnightCatchupWorker = createOvernightCatchupWorker(db, redisOptions);

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  fastify.addHook("onClose", async () => {
    await overnightCatchupWorker.close().catch(() => undefined);
    await slackAlertWorker.close().catch(() => undefined);
    await normalizationWorker.close().catch(() => undefined);
    await overnightCatchupQueue.close().catch(() => undefined);
    await slackAlertQueue.close().catch(() => undefined);
    await normalizationQueue.close().catch(() => undefined);
  });

  fastify.log.info(
    { host: redisOptions.host, port: redisOptions.port },
    "BullMQ normalization + slack-alert + overnight-catchup queues registered",
  );

  fastify.decorate("normalizationQueue", normalizationQueue);
  fastify.decorate("slackAlertQueue", slackAlertQueue);
};

export default fp(queuePlugin, { name: "queue", dependencies: [] });
