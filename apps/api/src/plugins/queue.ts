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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface QueuePluginOptions {
  db: Db;
}

/**
 * Registers the BullMQ normalization queue + Slack-alert queue and starts
 * their respective workers.
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
 * Both queues are exposed on the Fastify instance. A null value indicates that
 * Redis was unavailable at startup — handlers must treat this gracefully.
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

  // ── Workers ───────────────────────────────────────────────────────────────

  const normalizationWorker = createNormalizationWorker(
    db,
    redisOptions,
    slackAlertQueue,
  );

  const slackAlertWorker = createSlackAlertWorker(db, redisOptions);

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  fastify.addHook("onClose", async () => {
    await slackAlertWorker.close().catch(() => undefined);
    await normalizationWorker.close().catch(() => undefined);
    await slackAlertQueue.close().catch(() => undefined);
    await normalizationQueue.close().catch(() => undefined);
  });

  fastify.log.info(
    { host: redisOptions.host, port: redisOptions.port },
    "BullMQ normalization + slack-alert queues registered",
  );

  fastify.decorate("normalizationQueue", normalizationQueue);
  fastify.decorate("slackAlertQueue", slackAlertQueue);
};

export default fp(queuePlugin, { name: "queue", dependencies: [] });
