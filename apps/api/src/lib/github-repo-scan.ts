/**
 * GitHub repo-scan ingestion (FUL-98).
 *
 * This is the *correct* data source for aggregating a repository's activity.
 * The user-scoped Events API (`/users/{login}/events`) only returns one user's
 * personal timeline — commits/PRs by other contributors never appear, private
 * PushEvents are unreliable, and almost everything normalises to `null`. As a
 * result, NiteOwl repo activity was never ingested (fetched:405 inserted:0).
 *
 * Instead we poll `/repos/{owner}/{repo}/commits` and `/pulls` directly via
 * `fetchAllPages`, which deterministically captures *every* contributor's
 * commits, PRs, and merges within a time window.
 *
 * Inserts are idempotent: `ON CONFLICT DO NOTHING` on
 * (integration_id, external_id) means re-running the same window never
 * duplicates rows. The per-integration repo allowlist (FUL-82) is respected via
 * `isRepoAllowed`, the single source of truth shared by all ingestion paths.
 */

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { isRepoAllowed, type RepoAllowlistConfig } from './repo-allowlist.js';

// ---------------------------------------------------------------------------
// GitHub REST API types (minimal surface for repo-scan)
// ---------------------------------------------------------------------------

export interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  pushed_at: string | null;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  html_url: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  updated_at: string;
  user: { login: string } | null;
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
// Repo-scan ingestion
// ---------------------------------------------------------------------------

/** Minimal logger surface so callers can pass pino (`request.log`) or a shim. */
export interface RepoScanLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface RepoScanOptions {
  db: Db;
  userId: string;
  integrationId: string;
  /** Decrypted GitHub access token. */
  accessToken: string;
  /** Window start — only repos pushed at/after this are scanned. */
  since: Date;
  /** Window end. */
  until: Date;
  /**
   * Integration config carrying an optional `repoAllowlist` (FUL-82). When set,
   * only repos on the allowlist are scanned; unset/empty scans all active repos.
   */
  config?: RepoAllowlistConfig | null;
  /** Optional logger for per-repo failures (one bad repo never aborts the run). */
  logger?: RepoScanLogger;
}

export interface RepoScanResult {
  reposScanned: number;
  /** Rows newly inserted (excludes ON CONFLICT duplicates). */
  ingested: number;
  /** Rows built across all repos (inserted + duplicates). */
  total: number;
  /** Number of repos whose commit/PR fetch threw and were skipped. */
  errors: number;
  /** Most recent per-repo error, if any — for caller-side logging. */
  lastError?: Error;
}

/**
 * Polls commits + PRs for every active, allowlisted repo within the window and
 * upserts them into activity_events. Deterministically captures every
 * contributor's activity, unlike the user-scoped Events API.
 *
 * Throws only if the top-level `/user/repos` fetch fails (the caller decides
 * how to surface that). Per-repo failures are isolated, counted, and logged.
 */
export async function runGitHubRepoScan(opts: RepoScanOptions): Promise<RepoScanResult> {
  const { db, userId, integrationId, accessToken, since, until, config = null, logger } = opts;

  // ── Fetch recently-pushed repos the token can see ────────────────────────
  const repos = await fetchAllPages<GitHubRepo>(
    'https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100',
    accessToken,
  );

  // Only scan repos pushed within the window, and — when an allowlist is
  // configured (FUL-82) — only repos on it. No allowlist scans all active repos.
  const activeRepos = repos.filter(
    (r) =>
      r.pushed_at !== null && new Date(r.pushed_at) >= since && isRepoAllowed(config, r.full_name),
  );

  const rows: Array<typeof schema.activityEvents.$inferInsert> = [];
  let errors = 0;
  let lastError: Error | undefined;

  for (const repo of activeRepos) {
    const repoName = repo.full_name;

    // Commits within the window — captures every author, not just the user.
    try {
      const commits = await fetchAllPages<GitHubCommit>(
        `https://api.github.com/repos/${encodeURIComponent(repoName)}/commits` +
          `?since=${since.toISOString()}&until=${until.toISOString()}&per_page=100`,
        accessToken,
      );

      for (const commit of commits) {
        const authorDate = commit.commit.author?.date;
        if (!authorDate) continue;

        rows.push({
          userId,
          integrationId,
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
      errors++;
      lastError = err instanceof Error ? err : new Error(String(err));
      logger?.warn({ repo: repoName, err }, '[github-repo-scan] Failed to fetch commits');
    }

    // PRs updated within the window.
    try {
      const prs = await fetchAllPages<GitHubPullRequest>(
        `https://api.github.com/repos/${encodeURIComponent(repoName)}/pulls` +
          `?state=all&sort=updated&direction=desc&per_page=100`,
        accessToken,
      );

      for (const pr of prs) {
        const updatedAt = new Date(pr.updated_at);
        if (updatedAt < since || updatedAt > until) continue;

        const eventType =
          pr.state === 'open' ? 'pr_opened' : pr.merged_at !== null ? 'pr_merged' : 'pr_closed';

        const occurredAt =
          eventType === 'pr_merged' && pr.merged_at !== null ? new Date(pr.merged_at) : updatedAt;

        rows.push({
          userId,
          integrationId,
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
            author: pr.user?.login ?? null,
            state: pr.state,
            baseBranch: pr.base.ref,
          },
          occurredAt,
        });
      }
    } catch (err) {
      errors++;
      lastError = err instanceof Error ? err : new Error(String(err));
      logger?.warn({ repo: repoName, err }, '[github-repo-scan] Failed to fetch PRs');
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

  return {
    reposScanned: activeRepos.length,
    ingested,
    total: rows.length,
    errors,
    ...(lastError ? { lastError } : {}),
  };
}
