import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { Queue } from "bullmq";

import type { Db } from "@niteowl/db";
import type { NormalizationJobData } from "@niteowl/types";
import {
  NORMALIZATION_QUEUE,
  createNormalizationWorker,
} from "../workers/normalization.worker.js";

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    normalizationQueue: Queue<NormalizationJobData> | null;
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
 * Registers the BullMQ normalization queue and starts the worker.
 *
 * Default job options:
 *  - 5 attempts with exponential back-off (1 s → 2 s → 4 s → 8 s → 16 s)
 *  - Completed jobs retained for the last 1 000 entries (audit log)
 *  - Failed jobs retained for the last 5 000 entries (dead-letter store)
 *
 * The queue is exposed on fastify.normalizationQueue. A null value indicates
 * that Redis was unavailable at startup — webhook handlers must treat this
 * gracefully (log + continue without enqueueing).
 */
const queuePlugin: FastifyPluginAsync<QueuePluginOptions> = async (
  fastify,
  { db },
) => {
  const redisUrl =
    process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const redisOptions = parseRedisUrl(redisUrl);

  // defaultJobOptions applies to every job added via queue.add().
  // Retry logic: exponential back-off with a base delay of 1 s,
  // doubling each attempt up to the 5th (max ~16 s on the last retry).
  const jobDefaults = {
    attempts: 5,
    backoff: {
      type: "exponential" as const,
      delay: 1000,
    },
    // Keep completed jobs for observability (not strictly required).
    removeOnComplete: { count: 1000 },
    // Dead-letter store: retain the last 5 000 permanently-failed jobs.
    // Bull Board / any BullMQ dashboard can inspect these.
    removeOnFail: { count: 5000 },
  };

  // BullMQ connects lazily — the Queue and Worker are created without
  // blocking on a Redis connection. If Redis is down when the first job is
  // added, queue.add() will throw and the webhook handler logs + continues.
  const queue = new Queue<NormalizationJobData>(NORMALIZATION_QUEUE, {
    connection: redisOptions,
    defaultJobOptions: jobDefaults,
  });

  const worker = createNormalizationWorker(db, redisOptions);

  fastify.addHook("onClose", async () => {
    await worker.close().catch(() => undefined);
    await queue.close().catch(() => undefined);
  });

  fastify.log.info(
    { host: redisOptions.host, port: redisOptions.port },
    "BullMQ normalization queue registered",
  );

  fastify.decorate("normalizationQueue", queue);
};

export default fp(queuePlugin, { name: "queue", dependencies: [] });
