import { Worker } from "bullmq";
import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";
import type { Activity, NormalizationJobData } from "@niteowl/types";
import { normalizeEvent } from "../normalizers/index.js";

export const NORMALIZATION_QUEUE = "normalization";

/**
 * Maps a canonical Activity (from the normalizer layer) to a DB insert row.
 * The activities table omits `description` and stores metadata as `metadataJson`.
 */
function activityToRow(
  activity: Activity,
): typeof schema.activities.$inferInsert {
  return {
    // Let the DB generate the UUID if we don't pass one — but we pass ours for
    // determinism in tests.
    id: activity.id,
    userId: activity.userId,
    provider: activity.provider,
    eventType: activity.eventType,
    sourceId: activity.sourceId,
    title: activity.title,
    url: activity.url,
    metadataJson: activity.metadata,
    occurredAt: new Date(activity.occurredAt),
    ingestedAt: new Date(activity.ingestedAt),
  };
}

/**
 * Creates and starts the BullMQ normalization worker.
 *
 * Each job carries a {@link NormalizationJobData} payload. The worker:
 *  1. Routes the payload to the correct normalizer.
 *  2. Inserts the canonical Activity into the `activities` table.
 *  3. Skips (logs + ignores) unrecognised event types.
 *
 * Duplicate inserts are silently dropped via the unique constraint on
 * (user_id, provider, source_id).
 */
export function createNormalizationWorker(
  db: Db,
  redisOptions: { host: string; port: number },
): Worker<NormalizationJobData> {
  const worker = new Worker<NormalizationJobData>(
    NORMALIZATION_QUEUE,
    async (job) => {
      const { provider, userId, payload } = job.data;

      const activity = normalizeEvent(provider, payload, userId);

      if (activity === null) {
        console.warn(
          `[normalization-worker] Skipping unrecognised ${provider} event`,
          { jobId: job.id, provider, userId },
        );
        return;
      }

      const row = activityToRow(activity);

      await db
        .insert(schema.activities)
        .values(row)
        .onConflictDoNothing({
          target: [
            schema.activities.userId,
            schema.activities.provider,
            schema.activities.sourceId,
          ],
        });

      console.info(
        `[normalization-worker] Inserted activity ${activity.id} (${provider}:${activity.eventType})`,
      );
    },
    {
      connection: redisOptions,
      concurrency: 10,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[normalization-worker] Job ${job?.id ?? "unknown"} failed`, {
      provider: job?.data.provider,
      error: err.message,
    });
  });

  return worker;
}
