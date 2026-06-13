import { Worker } from "bullmq";
import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";
import type { Activity, NormalizationJobData } from "@niteowl/types";
import { normalizeEvent } from "../normalizers/index.js";
import { invalidateFeedCache } from "../routes/feed/index.js";
import {
  formatPrMergeAlert,
  sendSlackAlert,
  type PrMergeAlertData,
} from "../lib/slack-alert.js";
import { getEnabledAlertsForUser } from "../routes/slack-alerts/index.js";

export const NORMALIZATION_QUEUE = "normalization";

/**
 * Maps a canonical Activity (from the normalizer layer) to a DB insert row for
 * the `activity_events` table.
 *
 * Field mapping:
 *   Activity.sourceId   → activity_events.external_id  (provider-native dedup key)
 *   Activity.metadata   → activity_events.metadata      (jsonb)
 */
function activityToRow(
  activity: Activity,
  integrationId: string,
): typeof schema.activityEvents.$inferInsert {
  return {
    id: activity.id,
    userId: activity.userId,
    integrationId,
    provider: activity.provider,
    eventType: activity.eventType,
    externalId: activity.sourceId,
    title: activity.title,
    url: activity.url ?? null,
    metadata: activity.metadata,
    occurredAt: new Date(activity.occurredAt),
    ingestedAt: new Date(activity.ingestedAt),
  };
}

/**
 * Creates and starts the BullMQ normalization worker.
 *
 * Each job carries a {@link NormalizationJobData} payload. The worker:
 *  1. Routes the payload to the correct normalizer.
 *  2. Inserts the canonical ActivityEvent into the `activity_events` table.
 *  3. Invalidates the per-user feed cache so the new event appears within 5s.
 *  4. Skips (logs + ignores) unrecognised event types.
 *
 * Duplicate inserts are silently dropped via the unique constraint on
 * (integration_id, external_id).
 */
export function createNormalizationWorker(
  db: Db,
  redisOptions: { host: string; port: number },
): Worker<NormalizationJobData> {
  const worker = new Worker<NormalizationJobData>(
    NORMALIZATION_QUEUE,
    async (job) => {
      const { provider, userId, integrationId, payload } = job.data;

      const activity = normalizeEvent(provider, payload, userId);

      if (activity === null) {
        console.warn(
          `[normalization-worker] Skipping unrecognised ${provider} event`,
          { jobId: job.id, provider, userId },
        );
        return;
      }

      const row = activityToRow(activity, integrationId);

      await db
        .insert(schema.activityEvents)
        .values(row)
        .onConflictDoNothing({
          target: [
            schema.activityEvents.integrationId,
            schema.activityEvents.externalId,
          ],
        });

      console.info(
        `[normalization-worker] Inserted activity ${activity.id} (${provider}:${activity.eventType})`,
      );

      // ── Slack alerts — fire for PR merge events on GitHub ────────────────
      if (provider === "github" && activity.eventType === "pr_merged") {
        void fireSlackAlerts(db, activity).catch((err: unknown) => {
          console.warn(
            `[normalization-worker] Slack alert dispatch failed for activity ${activity.id}`,
            err,
          );
        });
      }

      // Invalidate per-user feed cache so the new event surfaces within 5s.
      // We create a temporary ioredis client using the same connection options
      // so the worker doesn't need a fastify instance reference.
      try {
        const { default: Redis } = await import("ioredis");
        const redis = new Redis(redisOptions);
        await invalidateFeedCache(redis, userId);
        await redis.quit();
      } catch (err) {
        // Cache invalidation is best-effort — a failure here must not block ingestion.
        console.warn(
          `[normalization-worker] Cache invalidation failed for user ${userId}`,
          err,
        );
      }
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

// ---------------------------------------------------------------------------
// Slack alert dispatch
// ---------------------------------------------------------------------------

/**
 * Queries all enabled Slack alert configs for the activity owner and sends
 * an alert to every webhook whose watchedRepos list includes the PR's repo.
 *
 * Failures per-webhook are logged but do not propagate — one bad webhook
 * must not prevent others from firing.
 */
async function fireSlackAlerts(db: Db, activity: Activity): Promise<void> {
  const meta = activity.metadata as Record<string, unknown>;
  const repo = typeof meta["repo"] === "string" ? meta["repo"] : null;
  const prNumber =
    typeof meta["prNumber"] === "number" ? meta["prNumber"] : 0;
  const author =
    typeof meta["author"] === "string" ? meta["author"] : "unknown";

  if (!repo) {
    console.warn(
      `[normalization-worker] PR merge activity ${activity.id} has no repo in metadata — skipping Slack alert`,
    );
    return;
  }

  // Extract base branch from PR title pattern "[owner/repo] PR #N: ..." or metadata
  const baseBranch =
    typeof meta["baseBranch"] === "string" ? meta["baseBranch"] : "main";

  const alertData: PrMergeAlertData = {
    repo,
    prNumber,
    prTitle: activity.title.replace(/^\[.*?\]\s*PR #\d+:\s*/, "").trim() || activity.title,
    author,
    url: activity.url ?? `https://github.com/${repo}`,
    baseBranch,
    occurredAt: activity.occurredAt,
  };

  const configs = await getEnabledAlertsForUser(db, activity.userId);
  const matchingConfigs = configs.filter(
    (c) =>
      c.watchedRepos.length === 0 ||
      c.watchedRepos.some(
        (watched) => watched.toLowerCase() === repo.toLowerCase(),
      ),
  );

  if (matchingConfigs.length === 0) return;

  const message = formatPrMergeAlert(alertData);

  await Promise.allSettled(
    matchingConfigs.map(async (config) => {
      try {
        const result = await sendSlackAlert(config.webhookUrl, message);
        console.info(
          `[normalization-worker] Slack alert sent to config ${config.id} after ${result.attempts} attempt(s)`,
        );
      } catch (err) {
        console.error(
          `[normalization-worker] Slack alert failed for config ${config.id}`,
          err,
        );
      }
    }),
  );
}
