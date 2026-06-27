// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { runGitHubRepoScan } from '../../lib/github-repo-scan.js';
import { requireAuth } from '../../plugins/auth.js';

// Re-exported so existing tests (and callers) keep importing the GitHub REST
// fetch helpers from this module. The implementations now live in the shared
// repo-scan lib alongside the ingestion logic they support.
export { fetchWithBackoff, fetchAllPages } from '../../lib/github-repo-scan.js';

// ---------------------------------------------------------------------------
// Route body type
// ---------------------------------------------------------------------------

interface CatchUpBody {
  since: string;
  until: string;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const githubCatchupRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  /**
   * POST /api/integrations/github/sync
   *
   * Triggers an immediate 24-hour activity backfill for the authenticated
   * user's GitHub integration. Runs asynchronously so the response returns
   * immediately; progress is visible in server logs and the integration's
   * lastSyncedAt timestamp is updated on completion.
   *
   * FUL-98: this now uses the deterministic repo-scan source
   * (`/repos/{owner}/{repo}/commits` + `/pulls`) rather than the user-scoped
   * Events API, so it captures every contributor's activity — not just the
   * connecting user's personal timeline.
   *
   * Rate-limited to 3 requests per minute to avoid hammering the GitHub API.
   */
  fastify.post(
    '/github/sync',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = request.user!.sub;

      const [row] = await db
        .select({
          integrationId: schema.integrations.id,
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
          and(
            eq(schema.integrations.userId, userId),
            eq(schema.integrations.provider, 'github'),
            eq(schema.integrations.enabled, true),
          ),
        )
        .limit(1);

      if (!row) {
        return reply
          .code(404)
          .send({ success: false, error: 'No enabled GitHub integration found' });
      }

      const until = new Date();
      const since = new Date(until.getTime() - 24 * 60 * 60 * 1000);

      // Fire and forget — the response returns immediately
      runGitHubRepoScan({
        db,
        userId,
        integrationId: row.integrationId,
        accessToken: row.accessToken,
        since,
        until,
        config: row.configJson as { repoAllowlist?: unknown } | null,
        logger: request.log,
      })
        .then((result) => {
          request.log.info(
            {
              userId,
              integrationId: row.integrationId,
              reposScanned: result.reposScanned,
              ingested: result.ingested,
              total: result.total,
              errors: result.errors,
              // Surface the actual per-repo failure. Pino only runs its Error
              // serializer on the `err`/`error` keys, so a raw Error spread under
              // any other key serialises to `{}` (the FUL-98 observability bug).
              lastErrorMessage: result.lastError?.message,
              lastErrorStack: result.lastError?.stack,
            },
            '[github-sync] repo-scan complete',
          );
          return db
            .update(schema.integrations)
            .set({ lastSyncedAt: new Date() })
            .where(eq(schema.integrations.id, row.integrationId));
        })
        .catch((err: unknown) => {
          request.log.error(
            { err, userId, integrationId: row.integrationId },
            '[github-sync] repo-scan failed',
          );
        });

      return reply.code(202).send({ success: true, message: 'Sync started' });
    },
  );

  /**
   * POST /api/integrations/github/:installationId/catch-up
   *
   * Fetches commits and PR events from the GitHub REST API for a given time
   * window and upserts them into activity_events, filling in any gaps left by
   * missed webhook deliveries.
   *
   * Body: { since: ISO, until: ISO }
   * Idempotent — re-running over the same window produces no duplicate rows.
   */
  fastify.post<{
    Params: { installationId: string };
    Body: CatchUpBody;
  }>(
    '/github/:installationId/catch-up',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { installationId } = request.params;
      const { since, until } = request.body ?? {};

      // ── Validate time window ─────────────────────────────────────────────────
      if (!since || !until || isNaN(Date.parse(since)) || isNaN(Date.parse(until))) {
        return reply.code(400).send({
          success: false,
          error: 'Body must include valid ISO 8601 `since` and `until` timestamps',
        });
      }

      const sinceDate = new Date(since);
      const untilDate = new Date(until);

      if (sinceDate >= untilDate) {
        return reply.code(400).send({
          success: false,
          error: '`since` must be before `until`',
        });
      }

      // ── Lookup integration — verify the authed user owns it ──────────────────
      const [integration] = await db
        .select({ id: schema.integrations.id, configJson: schema.integrations.configJson })
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.id, installationId),
            eq(schema.integrations.userId, userId),
            eq(schema.integrations.provider, 'github'),
            eq(schema.integrations.enabled, true),
          ),
        )
        .limit(1);

      if (!integration) {
        return reply.code(404).send({
          success: false,
          error: 'No enabled GitHub integration found for this installation ID',
        });
      }

      // ── Fetch OAuth token ────────────────────────────────────────────────────
      const [tokenRow] = await db
        .select({
          accessTokenEncrypted: schema.oauthTokens.accessTokenEncrypted,
        })
        .from(schema.oauthTokens)
        .where(
          and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, 'github')),
        )
        .limit(1);

      if (!tokenRow) {
        return reply.code(404).send({
          success: false,
          error: 'No GitHub OAuth token found',
        });
      }

      // ── Run the shared repo-scan ingestion ───────────────────────────────────
      try {
        const result = await runGitHubRepoScan({
          db,
          userId,
          integrationId: integration.id,
          accessToken: tokenRow.accessTokenEncrypted,
          since: sinceDate,
          until: untilDate,
          config: integration.configJson as { repoAllowlist?: unknown } | null,
          logger: request.log,
        });

        // ── Stamp last sync time ───────────────────────────────────────────────
        await db
          .update(schema.integrations)
          .set({ lastSyncedAt: new Date() })
          .where(eq(schema.integrations.id, integration.id));

        return reply.code(200).send({
          success: true,
          data: {
            reposScanned: result.reposScanned,
            ingested: result.ingested,
            total: result.total,
          },
        });
      } catch (err) {
        // The only throw path is a failed top-level `/user/repos` fetch.
        const message = err instanceof Error ? err.message : 'fetch_repos_failed';
        request.log.error({ error: message }, '[github-catchup] Failed to fetch repos');
        return reply.code(502).send({ success: false, error: message });
      }
    },
  );
};
