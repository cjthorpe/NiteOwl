import { Worker } from "bullmq";
import type { Queue } from "bullmq";
import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";
import type { Activity, NormalizationJobData, SlackAlertJobData } from "@niteowl/types";
import { normalizeEvent } from "../normalizers/index.js";
import { invalidateFeedCache } from "../routes/feed/index.js";
import { getEnabledAlertsForUser } from "../routes/slack-alerts/index.js";

export const NORMALIZATION_QUEUE = "normalization";

/**
 * Extracts the actor login / display name from a normalized activity's metadata.
 *
 * Tries fields in priority order so that the most-actionable identity surfaces:
 *   1. sender   — GitHub: who triggered the event (e.g. the bot that merged a PR)
 *   2. author   — GitHub/Linear/Jira: who created the item or wrote the comment
 *   3. creator  — Linear issues: display name of the issue creator
 *   4. reporter — Jira issues: display name of the reporter
 *   5. pusher   — GitHub push: name of the pusher
 *
 * Returns null when no recognisable actor field is present.
 */
export function extractAuthorLogin(
  metadata: Record<string, unknown>,
): string | null {
  const candidates = [
    metadata["sender"],
    metadata["author"],
    metadata["creator"],
    metadata["reporter"],
    metadata["pusher"],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return null;
}

/**
 * Maps a canonical Activity (from the normalizer layer) to a DB insert row for
 * the `activity_events` table.
 *
 * Field mapping:
 *   Activity.sourceId   → activity_events.external_id  (provider-native dedup key)
 *   Activity.metadata   → activity_events.metadata      (jsonb)
 *   extractAuthorLogin  → activity_events.author_login  (indexed actor column)
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
    authorLogin: extractAuthorLogin(activity.metadata),
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
 *  4. For GitHub PR merges, enqueues slack-alert jobs for matching configs.
 *  5. Skips (logs + ignores) unrecognised event types.
 *
 * Duplicate inserts are silently dropped via the unique constraint on
 * (integration_id, external_id).
 *
 * @param db               - Drizzle DB client.
 * @param redisOptions     - Redis connection options.
 * @param slackAlertQueue  - Optional queue for outbound Slack alerts (FUL-34).
 *                          When null, Slack alerts are silently skipped (e.g. test mode).
 */
export function createNormalizationWorker(
  db: Db,
  redisOptions: { host: string; port: number },
  slackAlertQueue: Queue<SlackAlertJobData> | null = null,
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

      // ── Slack alerts — enqueue for PR merge events on GitHub ─────────────
      if (
        provider === "github" &&
        activity.eventType === "pr_merged" &&
        slackAlertQueue !== null
      ) {
        void enqueueSlackAlerts(db, activity, slackAlertQueue).catch(
          (err: unknown) => {
            console.warn(
              `[normalization-worker] Slack alert enqueue failed for activity ${activity.id}`,
              err,
            );
          },
        );
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
// Slack alert dispatch — enqueue per-config jobs
// ---------------------------------------------------------------------------

/**
 * Resolves all enabled Slack alert configs for the activity owner, applies
 * watchedRepos and botUserLogins filters, then enqueues one slack-alert BullMQ
 * job per matching config.
 *
 * Filter logic:
 *   watchedRepos  — if non-empty, the PR's repo must be in the list (case-insensitive)
 *   botUserLogins — if non-empty, the PR's sender login must be in the list (case-insensitive)
 *
 * Each job is independently retried by BullMQ (3 retries, 60-second delay).
 */
async function enqueueSlackAlerts(
  db: Db,
  activity: Activity,
  queue: Queue<SlackAlertJobData>,
): Promise<void> {
  const meta = activity.metadata as Record<string, unknown>;
  const repo = typeof meta["repo"] === "string" ? meta["repo"] : null;
  const prNumber =
    typeof meta["prNumber"] === "number" ? meta["prNumber"] : 0;
  // `author` = PR creator login; `sender` = who triggered the merge action
  const sender =
    typeof meta["sender"] === "string" ? meta["sender"] : null;
  const author =
    typeof meta["author"] === "string" ? meta["author"] : "unknown";
  const baseBranch =
    typeof meta["baseBranch"] === "string" ? meta["baseBranch"] : "main";

  if (!repo) {
    console.warn(
      `[normalization-worker] PR merge activity ${activity.id} has no repo in metadata — skipping Slack alert`,
    );
    return;
  }

  const mergerLogin = sender ?? author; // fall back to author if sender absent

  const alertData: SlackAlertJobData["alertData"] = {
    repo,
    prNumber,
    prTitle:
      activity.title.replace(/^\[.*?\]\s*PR #\d+:\s*/, "").trim() ||
      activity.title,
    author,
    url: activity.url ?? `https://github.com/${repo}`,
    baseBranch,
    occurredAt: activity.occurredAt,
  };

  const configs = await getEnabledAlertsForUser(db, activity.userId);

  const matchingConfigs = configs.filter((c) => {
    // watchedRepos filter: empty means "all repos"
    if (
      c.watchedRepos.length > 0 &&
      !c.watchedRepos.some(
        (watched) => watched.toLowerCase() === repo.toLowerCase(),
      )
    ) {
      return false;
    }

    // botUserLogins filter: empty means "all mergers"
    if (
      c.botUserLogins.length > 0 &&
      !c.botUserLogins.some(
        (login) => login.toLowerCase() === mergerLogin.toLowerCase(),
      )
    ) {
      return false;
    }

    return true;
  });

  if (matchingConfigs.length === 0) return;

  await Promise.all(
    matchingConfigs.map((config) =>
      queue
        .add(
          "send-pr-merge-alert",
          { configId: config.id, userId: activity.userId, alertData },
          // Job-level options override queue defaults when needed — here we
          // rely entirely on the queue's defaultJobOptions (4 attempts, 60s delay).
        )
        .then((job) => {
          console.info(
            `[normalization-worker] Enqueued slack-alert job ${job.id ?? ""} for config ${config.id}`,
          );
        })
        .catch((err: unknown) => {
          console.error(
            `[normalization-worker] Failed to enqueue slack-alert for config ${config.id}`,
            err,
          );
        }),
    ),
  );
}
