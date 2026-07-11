// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * BullMQ worker for the overnight catch-up job (FUL-60).
 *
 * The overnight-catchup job fires once per day (default 06:00 UTC, configurable
 * via CATCHUP_HOUR_UTC) and iterates all active integrations, calling the
 * appropriate catch-up logic for each provider. It is designed to recover any
 * webhook events that were missed during the overnight window.
 *
 * Failure policy:
 *  - A failed catch-up for one integration is logged and skipped; the job
 *    continues with the remaining integrations (no all-or-nothing failure).
 *  - If the job itself fails entirely, BullMQ will retry it up to the
 *    configured attempt limit.
 *
 * Idempotency:
 *  - runLinearCatchup uses ON CONFLICT DO NOTHING on (integration_id, external_id),
 *    so re-running the job for the same window never duplicates events.
 *
 * Observability:
 *  - completed / failed events are emitted on the BullMQ worker for any
 *    connected Bull Board / Arena dashboard to consume.
 *  - Per-integration results are logged at info level.
 */

import { randomUUID } from 'node:crypto';

import type { Db } from '@niteowl/db';
import { decryptToken, schema } from '@niteowl/db';
import { Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { attachDeadLetterHandler } from '../lib/dead-letter.js';
import { runLinearCatchup } from '../lib/linear-catchup.js';
import { ingestionErrorsTotal, reportIngestionRun, timeSpan } from '../lib/metrics.js';

// ---------------------------------------------------------------------------
// Queue name + job data type
// ---------------------------------------------------------------------------

export const OVERNIGHT_CATCHUP_QUEUE = 'overnight-catchup';

/**
 * No per-job input needed — the worker queries all active integrations from
 * the database at runtime.
 */
export type OvernightCatchupJobData = Record<string, never>;

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates and starts the BullMQ overnight catch-up worker.
 *
 * Concurrency is set to 1: the job runs nightly and processes integrations
 * sequentially, keeping memory usage low and rate-limit pressure minimal.
 *
 * @param db          - Drizzle DB client for integration + token queries.
 * @param redisOptions - Redis connection options (host + port).
 */
export function createOvernightCatchupWorker(
  db: Db,
  redisOptions: { host: string; port: number },
): Worker<OvernightCatchupJobData> {
  const worker = new Worker<OvernightCatchupJobData>(
    OVERNIGHT_CATCHUP_QUEUE,
    async (job) => {
      const label = `[overnight-catchup] job ${job.id ?? '?'}`;
      // Per-run correlation id (FUL-145): threaded into every span log and the
      // silent-ingestion Slack alert so a blackout can be traced end-to-end.
      const traceId = randomUUID();
      // Gate the silent-ingestion alert on the webhook; unset → clean no-op.
      const webhookUrl = process.env['SLACK_ALERT_WEBHOOK_URL'];
      console.info(`${label} starting trace=${traceId}`);

      let totalIngested = 0;
      let totalErrors = 0;

      // ── Linear integrations ─────────────────────────────────────────────────
      //
      // JOIN integrations → oauth_tokens on (userId, provider) to fetch
      // the access token in a single query. Only enabled integrations are
      // processed; disabled ones are skipped silently.

      const linearRows = await db
        .select({
          integrationId: schema.integrations.id,
          userId: schema.integrations.userId,
          accessToken: schema.oauthTokens.accessTokenEncrypted,
        })
        .from(schema.integrations)
        .innerJoin(
          schema.oauthTokens,
          and(
            eq(schema.oauthTokens.userId, schema.integrations.userId),
            eq(schema.oauthTokens.provider, 'linear'),
          ),
        )
        .where(
          and(eq(schema.integrations.provider, 'linear'), eq(schema.integrations.enabled, true)),
        );

      for (const row of linearRows) {
        try {
          const result = await timeSpan(
            { name: 'linear.catchup', provider: 'linear', source: 'catchup', traceId },
            () =>
              runLinearCatchup({
                db,
                userId: row.userId,
                integrationId: row.integrationId,
                accessToken: decryptToken(row.accessToken),
              }),
          );
          totalIngested += result.ingested;
          // Record counters + fire the silent-ingestion alert on a blackout.
          await reportIngestionRun(
            {
              provider: 'linear',
              source: 'catchup',
              fetched: result.fetched,
              inserted: result.ingested,
              traceId,
            },
            { webhookUrl },
          );
          console.info(
            `${label} linear user=${row.userId} integration=${row.integrationId} fetched=${result.fetched} ingested=${result.ingested}`,
          );
        } catch (err) {
          totalErrors++;
          ingestionErrorsTotal.inc({ provider: 'linear', source: 'catchup' }, 1);
          console.error(
            `${label} linear catchup failed integration=${row.integrationId}`,
            err instanceof Error ? err.message : err,
          );
          // Continue with remaining integrations — do not abort the job.
        }
      }

      // ── GitHub integrations ─────────────────────────────────────────────────
      //
      // FUL-98: ingest via the deterministic repo-scan source
      // (`/repos/{owner}/{repo}/commits` + `/pulls`) rather than the user-scoped
      // Events API. The Events API only returns the connecting user's personal
      // timeline, so commits/PRs by other contributors never landed on the board.
      // Repo-scan needs only the access token (`/user/repos`), so no githubLogin
      // is required. The per-integration allowlist (FUL-82) is respected.

      const githubRows = await db
        .select({
          integrationId: schema.integrations.id,
          userId: schema.integrations.userId,
          configJson: schema.integrations.configJson,
          accessToken: schema.oauthTokens.accessTokenEncrypted,
        })
        .from(schema.integrations)
        .innerJoin(
          schema.oauthTokens,
          and(
            eq(schema.oauthTokens.userId, schema.integrations.userId),
            eq(schema.oauthTokens.provider, 'github'),
          ),
        )
        .where(
          and(eq(schema.integrations.provider, 'github'), eq(schema.integrations.enabled, true)),
        );

      // Catch-up window: the last 24 h, matching the nightly cadence.
      const until = new Date();
      const since = new Date(until.getTime() - 24 * 60 * 60 * 1000);

      for (const row of githubRows) {
        try {
          const { runGitHubRepoScan } = await import('../lib/github-repo-scan.js');
          const result = await timeSpan(
            { name: 'github.repo_scan', provider: 'github', source: 'repo_scan', traceId },
            () =>
              runGitHubRepoScan({
                db,
                userId: row.userId,
                integrationId: row.integrationId,
                accessToken: decryptToken(row.accessToken),
                since,
                until,
                config: row.configJson as { repoAllowlist?: unknown } | null,
              }),
          );
          totalIngested += result.ingested;
          // Map repo-scan `total`→fetched, `ingested`→inserted (FUL-145). This is
          // the exact FUL-98 blackout shape: total>0 && ingested==0.
          await reportIngestionRun(
            {
              provider: 'github',
              source: 'repo_scan',
              fetched: result.total,
              inserted: result.ingested,
              errors: result.errors,
              traceId,
            },
            { webhookUrl },
          );
          console.info(
            `${label} github user=${row.userId} integration=${row.integrationId} reposScanned=${result.reposScanned} ingested=${result.ingested} total=${result.total} errors=${result.errors} requestsUsed=${result.requestsUsed} rateLimited=${result.rateLimited}`,
          );
          // A rate-budgeted scan leaves repos unscanned (FUL-130): surface it so
          // a persistently truncated large-org integration is visible, not silent.
          if (result.rateLimited) {
            console.warn(
              `${label} github repo-scan truncated by rate budget integration=${row.integrationId} reposSkipped=${result.reposSkipped} requestsUsed=${result.requestsUsed}`,
            );
          }
          // Surface per-repo failures the scan isolated & counted rather than
          // letting them vanish: a bad repo is skipped-and-counted, not silently
          // dropped.
          if (result.errors > 0) {
            console.error(
              `${label} github repo-scan had ${result.errors} per-repo error(s) integration=${row.integrationId}`,
              result.lastError?.message ?? 'unknown',
            );
          }
        } catch (err) {
          totalErrors++;
          ingestionErrorsTotal.inc({ provider: 'github', source: 'repo_scan' }, 1);
          console.error(
            `${label} github repo-scan failed integration=${row.integrationId}`,
            err instanceof Error ? err.message : err,
          );
          // Continue with remaining integrations — do not abort the job.
        }
      }

      // ── Jira integrations ────────────────────────────────────────────────────
      //
      // FUL-141: fetch recently-updated issues via the Jira REST search API and
      // normalize them through the SHARED canonical core so their external ids
      // collide with the webhook path (no double-ingest). configJson carries
      // both cloudId (for REST) and siteUrl (for webhook/external-id parity).
      // runJiraCatchup refreshes + rotates the Atlassian token as needed.

      const jiraRows = await db
        .select({
          integrationId: schema.integrations.id,
          userId: schema.integrations.userId,
          configJson: schema.integrations.configJson,
          accessTokenEncrypted: schema.oauthTokens.accessTokenEncrypted,
          refreshTokenEncrypted: schema.oauthTokens.refreshTokenEncrypted,
          expiresAt: schema.oauthTokens.expiresAt,
        })
        .from(schema.integrations)
        .innerJoin(
          schema.oauthTokens,
          and(
            eq(schema.oauthTokens.userId, schema.integrations.userId),
            eq(schema.oauthTokens.provider, 'jira'),
          ),
        )
        .where(
          and(eq(schema.integrations.provider, 'jira'), eq(schema.integrations.enabled, true)),
        );

      for (const row of jiraRows) {
        const config = (row.configJson as { cloudId?: unknown; siteUrl?: unknown } | null) ?? {};
        const cloudId = typeof config.cloudId === 'string' ? config.cloudId : null;
        const siteUrl = typeof config.siteUrl === 'string' ? config.siteUrl : null;

        if (!cloudId || !siteUrl) {
          console.error(
            `${label} jira integration=${row.integrationId} missing cloudId/siteUrl — skipping`,
          );
          totalErrors++;
          continue;
        }

        try {
          const { runJiraCatchup } = await import('../lib/jira-catchup.js');
          const result = await timeSpan(
            { name: 'jira.catchup', provider: 'jira', source: 'catchup', traceId },
            () =>
              runJiraCatchup({
                db,
                userId: row.userId,
                integrationId: row.integrationId,
                cloudId,
                siteUrl,
                accessTokenEncrypted: row.accessTokenEncrypted,
                refreshTokenEncrypted: row.refreshTokenEncrypted,
                expiresAt: row.expiresAt,
              }),
          );
          totalIngested += result.ingested;
          await reportIngestionRun(
            {
              provider: 'jira',
              source: 'catchup',
              fetched: result.fetched,
              inserted: result.ingested,
              traceId,
            },
            { webhookUrl },
          );
          console.info(
            `${label} jira user=${row.userId} integration=${row.integrationId} fetched=${result.fetched} ingested=${result.ingested}`,
          );
        } catch (err) {
          totalErrors++;
          ingestionErrorsTotal.inc({ provider: 'jira', source: 'catchup' }, 1);
          console.error(
            `${label} jira catchup failed integration=${row.integrationId}`,
            err instanceof Error ? err.message : err,
          );
          // Continue with remaining integrations — do not abort the job.
        }
      }

      console.info(
        `${label} complete — ingested=${totalIngested} errors=${totalErrors} linear_integrations=${linearRows.length} github_integrations=${githubRows.length} jira_integrations=${jiraRows.length}`,
      );
    },
    {
      connection: redisOptions,
      // One concurrent job is sufficient: the catch-up runs once per day and
      // processes integrations sequentially within a single execution.
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[overnight-catchup] job ${job?.id ?? 'unknown'} failed`, { error: err.message });
  });

  worker.on('completed', (job) => {
    console.info(`[overnight-catchup] job ${job.id ?? ''} completed`);
  });

  // Dead-letter alerting (FUL-131): fires once, only when a job exhausts retries.
  attachDeadLetterHandler(worker, OVERNIGHT_CATCHUP_QUEUE);

  return worker;
}
