import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { requireAuth } from '../../plugins/auth.js';
import { runGitHubCatchup } from '../../lib/github-catchup.js';

// ---------------------------------------------------------------------------
// GitHub REST API types (minimal surface for catchup)
// ---------------------------------------------------------------------------

interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  pushed_at: string | null;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  html_url: string;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  updated_at: string;
  user: { login: string };
  base: { ref: string };
}

// ---------------------------------------------------------------------------
// Rate-limit helpers — exponential backoff on 429 / 403
// ---------------------------------------------------------------------------

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1_000;

export async function fetchWithBackoff(url: string, token: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if ((res.status === 429 || res.status === 403) && attempt < MAX_RETRIES) {
    // Honour Retry-After when GitHub supplies it; otherwise exponential backoff.
    // A header value of "0" means "retry immediately" per RFC 7231 §7.1.3.
    const retryAfterHeader = res.headers.get('retry-after');
    const delayMs =
      retryAfterHeader !== null
        ? parseInt(retryAfterHeader, 10) * 1_000
        : BASE_DELAY_MS * 2 ** attempt;

    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return fetchWithBackoff(url, token, attempt + 1);
  }

  return res;
}

// ---------------------------------------------------------------------------
// Paginated fetcher — follows RFC 5988 Link headers
// ---------------------------------------------------------------------------

export async function fetchAllPages<T>(firstUrl: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = firstUrl;

  while (url !== null) {
    const res = await fetchWithBackoff(url, token);

    if (!res.ok) {
      if (res.status === 404) break; // repo may have been deleted
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const page = (await res.json()) as T[];
    results.push(...page);

    const link = res.headers.get('link') ?? '';
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? null;
  }

  return results;
}

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
   * user's GitHub integration using the Events API. Runs asynchronously so
   * the response returns immediately; progress is visible in server logs and
   * the integration's lastSyncedAt timestamp is updated on completion.
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

      const config = row.configJson as { githubLogin?: string } | null;
      const githubLogin = config?.githubLogin ?? null;

      if (!githubLogin) {
        return reply.code(422).send({
          success: false,
          error: 'GitHub login not stored — please reconnect your GitHub account',
        });
      }

      // Fire and forget — the response returns immediately
      runGitHubCatchup({
        db,
        userId,
        integrationId: row.integrationId,
        githubLogin,
        accessToken: row.accessToken,
      })
        .then((result) => {
          request.log.info(
            { userId, integrationId: row.integrationId, ...result },
            '[github-sync] catchup complete',
          );
          return db
            .update(schema.integrations)
            .set({ lastSyncedAt: new Date() })
            .where(eq(schema.integrations.id, row.integrationId));
        })
        .catch((err: unknown) => {
          request.log.error(
            { err, userId, integrationId: row.integrationId },
            '[github-sync] catchup failed',
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
        .select({ id: schema.integrations.id })
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

      const accessToken = tokenRow.accessTokenEncrypted;

      // ── Fetch recently-pushed repos ──────────────────────────────────────────
      let repos: GitHubRepo[];
      try {
        repos = await fetchAllPages<GitHubRepo>(
          'https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100',
          accessToken,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fetch_repos_failed';
        request.log.error({ error: message }, '[github-catchup] Failed to fetch repos');
        return reply.code(502).send({ success: false, error: message });
      }

      // Only scan repos that had activity at or after the window start.
      const activeRepos = repos.filter(
        (r) => r.pushed_at !== null && new Date(r.pushed_at) >= sinceDate,
      );

      const rows: Array<typeof schema.activityEvents.$inferInsert> = [];

      // ── Per-repo commit + PR polling ─────────────────────────────────────────
      for (const repo of activeRepos) {
        const repoName = repo.full_name;

        // Commits within the window
        try {
          const commits = await fetchAllPages<GitHubCommit>(
            `https://api.github.com/repos/${encodeURIComponent(repoName)}/commits` +
              `?since=${sinceDate.toISOString()}&until=${untilDate.toISOString()}&per_page=100`,
            accessToken,
          );

          for (const commit of commits) {
            const authorDate = commit.commit.author?.date;
            if (!authorDate) continue;

            rows.push({
              userId,
              integrationId: integration.id,
              provider: 'github',
              eventType: 'commit_pushed',
              // Dedup key: commit SHA is globally unique within a repo.
              externalId: `commit:${commit.sha}`,
              title: `[${repoName}] ${commit.commit.message.split('\n')[0]}`,
              url: commit.html_url,
              metadata: {
                sha: commit.sha,
                repo: repoName,
                author: commit.commit.author?.name ?? null,
                message: commit.commit.message,
              },
              occurredAt: new Date(authorDate),
            });
          }
        } catch (err) {
          // Log and continue — one failing repo should not abort the whole run.
          request.log.warn(
            { repo: repoName, err },
            '[github-catchup] Failed to fetch commits — skipping repo',
          );
        }

        // PRs updated within the window
        try {
          const prs = await fetchAllPages<GitHubPullRequest>(
            `https://api.github.com/repos/${encodeURIComponent(repoName)}/pulls` +
              `?state=all&sort=updated&direction=desc&per_page=100`,
            accessToken,
          );

          for (const pr of prs) {
            const updatedAt = new Date(pr.updated_at);
            if (updatedAt < sinceDate || updatedAt > untilDate) continue;

            const eventType =
              pr.state === 'open' ? 'pr_opened' : pr.merged_at !== null ? 'pr_merged' : 'pr_closed';

            const occurredAt =
              eventType === 'pr_merged' && pr.merged_at !== null
                ? new Date(pr.merged_at)
                : updatedAt;

            rows.push({
              userId,
              integrationId: integration.id,
              provider: 'github',
              eventType,
              // Suffix distinguishes catch-up entries from webhook-generated ones,
              // while still ensuring a single dedup key per PR per integration.
              externalId: `pr:${pr.id}:catch-up`,
              title: `[${repoName}] PR #${pr.number}: ${pr.title}`,
              url: pr.html_url,
              metadata: {
                prNumber: pr.number,
                repo: repoName,
                author: pr.user.login,
                state: pr.state,
                baseBranch: pr.base.ref,
              },
              occurredAt,
            });
          }
        } catch (err) {
          request.log.warn(
            { repo: repoName, err },
            '[github-catchup] Failed to fetch PRs — skipping repo',
          );
        }
      }

      // ── Upsert with deduplication ────────────────────────────────────────────
      let ingested = 0;
      if (rows.length > 0) {
        const inserted = await db
          .insert(schema.activityEvents)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: schema.activityEvents.id });

        ingested = inserted.length;
      }

      // ── Stamp last sync time ─────────────────────────────────────────────────
      await db
        .update(schema.integrations)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.integrations.id, integration.id));

      return reply.code(200).send({
        success: true,
        data: {
          reposScanned: activeRepos.length,
          ingested,
          total: rows.length,
        },
      });
    },
  );
};
