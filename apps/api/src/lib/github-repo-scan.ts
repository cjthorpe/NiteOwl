// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
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
// Rate budgeting + backpressure (FUL-130)
// ---------------------------------------------------------------------------

/**
 * Default ceiling on GitHub REST requests issued by a single scan run. GitHub's
 * authenticated REST budget is 5000 req/hour; a single integration's catch-up
 * should never monopolise it, and a large org could otherwise fan out to
 * thousands of requests (N repos × all commit/PR pages). 900 leaves ample
 * headroom for webhooks and other integrations sharing the same token.
 */
export const DEFAULT_MAX_REQUESTS = 900;

/**
 * Stop issuing new requests once GitHub reports this few requests remaining in
 * the current window. Proactive backpressure: we back off *before* exhausting
 * the quota (which would 403 every other caller) rather than reacting to a 429.
 */
export const DEFAULT_MIN_REMAINING = 100;

export interface RateBudgetOptions {
  /** Hard cap on total GitHub requests per scan run. Defaults to {@link DEFAULT_MAX_REQUESTS}. */
  maxRequests?: number;
  /** Reserve floor on GitHub's reported remaining quota. Defaults to {@link DEFAULT_MIN_REMAINING}. */
  minRemaining?: number;
}

/**
 * Tracks request spend across a scan and decides when to apply backpressure.
 *
 * Two independent limits, whichever bites first:
 *  - a per-run request cap (pagination budget), and
 *  - GitHub's own `x-ratelimit-remaining`, observed from every response so we
 *    stop before draining the shared token quota.
 *
 * Deliberately stateful (a spend counter is not meaningfully immutable); callers
 * check {@link canSpend} before each request and read {@link throttled} after the
 * run to distinguish a complete scan from a budget-truncated one.
 */
export class RateBudget {
  readonly maxRequests: number;
  readonly minRemaining: number;
  private used = 0;
  private remaining = Number.POSITIVE_INFINITY;
  private throttledFlag = false;

  constructor(options: RateBudgetOptions = {}) {
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.minRemaining = options.minRemaining ?? DEFAULT_MIN_REMAINING;
  }

  /** Whether another request is permitted under both the run cap and GitHub's quota. */
  canSpend(): boolean {
    return this.used < this.maxRequests && this.remaining > this.minRemaining;
  }

  /** Records that a request is about to be issued. */
  spend(): void {
    this.used += 1;
  }

  /** Updates the observed remaining quota from a response's rate-limit header. */
  observe(res: Response): void {
    const header = res.headers.get('x-ratelimit-remaining');
    if (header === null) return;
    const value = Number.parseInt(header, 10);
    if (!Number.isNaN(value)) this.remaining = value;
  }

  /** Marks that the budget forced early termination somewhere in the run. */
  markThrottled(): void {
    this.throttledFlag = true;
  }

  /** True when the run stopped short because a budget limit was reached. */
  get throttled(): boolean {
    return this.throttledFlag;
  }

  get requestsUsed(): number {
    return this.used;
  }
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

/**
 * Encodes a `owner/repo` full name for use in a GitHub API path.
 *
 * `encodeURIComponent('owner/repo')` encodes the slash to `%2F`, which GitHub
 * does **not** decode in a path — it treats `owner%2Frepo` as a single literal
 * segment and 404s. `fetchAllPages` then swallows that 404 as a deleted repo and
 * returns `[]`, so every commit/PR is silently dropped (FUL-98: the
 * `reposScanned:1 total:0 errors:0` blackout). Encode each segment separately so
 * the path separator survives while owner/repo are still escaped.
 */
export function encodeRepoPath(repoFullName: string): string {
  return repoFullName.split('/').map(encodeURIComponent).join('/');
}

export interface FetchAllPagesOptions<T> {
  /** Shared budget; when exhausted, pagination stops and the budget is flagged throttled. */
  budget?: RateBudget;
  /** Per-call ceiling on pages followed. Defaults to unbounded (Link headers govern). */
  maxPages?: number;
  /**
   * Early-termination predicate, evaluated after each page is collected. Return
   * `true` to stop following `rel="next"`. Used to halt window-sorted endpoints
   * (e.g. PRs sorted by `updated desc`) once a page falls entirely before the
   * window, instead of paginating the whole repo history (FUL-130).
   */
  stopWhen?: (page: T[]) => boolean;
}

export async function fetchAllPages<T>(
  firstUrl: string,
  token: string,
  options: FetchAllPagesOptions<T> = {},
): Promise<T[]> {
  const { budget, maxPages = Number.POSITIVE_INFINITY, stopWhen } = options;
  const results: T[] = [];
  let url: string | null = firstUrl;
  let pages = 0;

  while (url !== null) {
    if (pages >= maxPages) {
      budget?.markThrottled();
      break;
    }
    if (budget && !budget.canSpend()) {
      budget.markThrottled();
      break;
    }

    budget?.spend();
    const res = await fetchWithBackoff(url, token);
    budget?.observe(res);

    if (!res.ok) {
      if (res.status === 404) break; // repo may have been deleted
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const page = (await res.json()) as T[];
    results.push(...page);
    pages += 1;

    if (stopWhen?.(page)) break;

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
  /**
   * Pagination budgeting + backpressure for large orgs (FUL-130). Caps the
   * requests a single scan issues and backs off before draining GitHub's quota.
   * Omit to use {@link DEFAULT_MAX_REQUESTS} / {@link DEFAULT_MIN_REMAINING}.
   */
  rateBudget?: RateBudgetOptions;
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
  /**
   * True when the run stopped short of scanning every eligible repo because the
   * request budget or GitHub's remaining quota was exhausted (FUL-130). Callers
   * should surface this — a truncated scan is not a complete one.
   */
  rateLimited: boolean;
  /** Eligible repos left unscanned because the budget was reached. */
  reposSkipped: number;
  /** Total GitHub requests issued by the run. */
  requestsUsed: number;
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

  // One budget spans the whole run: the repo listing, plus every repo's commit
  // and PR pagination all draw from the same request allowance and GitHub quota.
  const budget = new RateBudget(opts.rateBudget);

  // ── Fetch recently-pushed repos the token can see ────────────────────────
  const repos = await fetchAllPages<GitHubRepo>(
    'https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100',
    accessToken,
    { budget },
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
  let reposScanned = 0;

  // PRs come back sorted by `updated desc`, so once a page's oldest entry falls
  // before the window every later page does too — stop paginating there instead
  // of pulling the repo's entire PR history (FUL-130).
  const prPageBeforeWindow = (page: GitHubPullRequest[]): boolean => {
    const oldest = page[page.length - 1];
    return oldest !== undefined && new Date(oldest.updated_at) < since;
  };

  for (const repo of activeRepos) {
    // Stop before the next repo once the budget/quota is spent rather than
    // partially scanning a repo — the run reports the remainder as skipped.
    if (!budget.canSpend()) {
      budget.markThrottled();
      break;
    }

    const repoName = repo.full_name;
    reposScanned += 1;

    // Commits within the window — captures every author, not just the user.
    try {
      const commits = await fetchAllPages<GitHubCommit>(
        `https://api.github.com/repos/${encodeRepoPath(repoName)}/commits` +
          `?since=${since.toISOString()}&until=${until.toISOString()}&per_page=100`,
        accessToken,
        { budget },
      );

      for (const commit of commits) {
        const authorDate = commit.commit.author?.date;
        if (!authorDate) continue;

        const author = commit.commit.author?.name ?? null;
        rows.push({
          userId,
          integrationId,
          provider: 'github',
          eventType: 'commit_pushed',
          // Dedup key: commit SHA is globally unique within a repo.
          externalId: `commit:${commit.sha}`,
          title: `[${repoName}] ${commit.commit.message.split('\n')[0]}`,
          url: commit.html_url,
          // Populate the indexed actor column so the briefing groups by real
          // contributor (not "(unknown)") and the feed `?author=` filter works
          // for repo-scan rows (FUL-139).
          authorLogin: author,
          metadata: {
            sha: commit.sha,
            repo: repoName,
            author,
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
        `https://api.github.com/repos/${encodeRepoPath(repoName)}/pulls` +
          `?state=all&sort=updated&direction=desc&per_page=100`,
        accessToken,
        { budget, stopWhen: prPageBeforeWindow },
      );

      for (const pr of prs) {
        const updatedAt = new Date(pr.updated_at);
        if (updatedAt < since || updatedAt > until) continue;

        const eventType =
          pr.state === 'open' ? 'pr_opened' : pr.merged_at !== null ? 'pr_merged' : 'pr_closed';

        const occurredAt =
          eventType === 'pr_merged' && pr.merged_at !== null ? new Date(pr.merged_at) : updatedAt;

        const author = pr.user?.login ?? null;
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
          // Indexed actor column — see commit branch above (FUL-139).
          authorLogin: author,
          metadata: {
            prNumber: pr.number,
            repo: repoName,
            author,
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

  const reposSkipped = activeRepos.length - reposScanned;
  if (budget.throttled) {
    logger?.warn(
      { integrationId, reposScanned, reposSkipped, requestsUsed: budget.requestsUsed },
      '[github-repo-scan] Rate budget reached — scan truncated',
    );
  }

  return {
    reposScanned,
    ingested,
    total: rows.length,
    errors,
    rateLimited: budget.throttled,
    reposSkipped,
    requestsUsed: budget.requestsUsed,
    ...(lastError ? { lastError } : {}),
  };
}
