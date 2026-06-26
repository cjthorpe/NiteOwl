/**
 * GitHub REST API catchup — fetches the last 24 h of events for a user and
 * inserts them into activity_events, respecting X-RateLimit-* headers.
 */

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { normalizeGitHubEvent } from '../normalizers/github.js';
import { isRepoAllowed, type RepoAllowlistConfig } from './repo-allowlist.js';

// ---------------------------------------------------------------------------
// GitHub Events API types (minimal surface we care about)
// ---------------------------------------------------------------------------

interface GitHubEvent {
  id: string;
  type: string;
  // The Events API can omit `actor` (ghost / deleted accounts) and, rarely,
  // `repo`. Model them as optional so reads are forced through null-safe access
  // and a single malformed item cannot throw and abort the catchup run.
  actor?: { id: number; login: string } | null;
  repo?: { id: number; name: string } | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface RateLimitInfo {
  remaining: number;
  /** Unix timestamp (seconds) when the window resets */
  reset: number;
}

// ---------------------------------------------------------------------------
// Rate-limit helpers
// ---------------------------------------------------------------------------

function parseRateLimit(headers: Headers): RateLimitInfo {
  const remaining = parseInt(headers.get('x-ratelimit-remaining') ?? '60', 10);
  const reset = parseInt(
    headers.get('x-ratelimit-reset') ?? String(Math.floor(Date.now() / 1000) + 60),
    10,
  );
  return { remaining, reset };
}

/**
 * When fewer than `threshold` requests remain in the current window, sleep
 * until the reset timestamp plus a small buffer.
 */
async function respectRateLimit(info: RateLimitInfo, threshold = 5): Promise<void> {
  if (info.remaining < threshold) {
    const nowMs = Date.now();
    const resetMs = info.reset * 1000;
    const waitMs = Math.max(0, resetMs - nowMs + 500); // +500 ms safety buffer
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

// ---------------------------------------------------------------------------
// GitHub API fetch helpers
// ---------------------------------------------------------------------------

async function fetchGitHubPage(
  url: string,
  accessToken: string,
): Promise<{ events: GitHubEvent[]; nextUrl: string | null; rateLimit: RateLimitInfo }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    if (res.status === 304) {
      // Not Modified (ETag / If-None-Match) — no new events
      return { events: [], nextUrl: null, rateLimit: parseRateLimit(res.headers) };
    }
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const rateLimit = parseRateLimit(res.headers);
  const events = (await res.json()) as GitHubEvent[];

  // GitHub uses RFC 5988 Link headers for pagination: <url>; rel="next"
  const linkHeader = res.headers.get('link') ?? '';
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  const nextUrl = nextMatch?.[1] ?? null;

  return { events, nextUrl, rateLimit };
}

// ---------------------------------------------------------------------------
// Main catchup function
// ---------------------------------------------------------------------------

export interface CatchupOptions {
  db: Db;
  userId: string;
  integrationId: string;
  /** GitHub login name (e.g. "octocat") */
  githubLogin: string;
  /** Decrypted GitHub access token */
  accessToken: string;
  /** How many hours to look back — default 24 */
  lookbackHours?: number;
  /**
   * Integration config carrying an optional `repoAllowlist` (FUL-82). When the
   * allowlist is non-empty, events whose repo is not on it are skipped at
   * ingestion. Unset / empty preserves account-wide aggregation.
   */
  config?: RepoAllowlistConfig | null;
}

export interface CatchupResult {
  fetched: number;
  inserted: number;
  skipped: number;
  /** Number of events that threw during normalization/insert and were skipped. */
  errors: number;
  /** The most recent per-event error, if any — for caller-side logging. */
  lastError?: Error;
}

/**
 * Fetches the user's GitHub events from the REST API and inserts any
 * events created within the last `lookbackHours` hours into activity_events.
 *
 * Handles pagination and respects X-RateLimit-* headers.
 */
export async function runGitHubCatchup(opts: CatchupOptions): Promise<CatchupResult> {
  const {
    db,
    userId,
    integrationId,
    githubLogin,
    accessToken,
    lookbackHours = 24,
    config = null,
  } = opts;

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // GitHub events API returns events for a user: received_events includes PRs,
  // issues, pushes authored by or relevant to the user's repos.
  // We use /users/{login}/events (own events) + /users/{login}/received_events
  // for maximum coverage. Duplicates are handled by the unique constraint.
  const startUrls = [
    `https://api.github.com/users/${encodeURIComponent(githubLogin)}/events?per_page=100`,
    `https://api.github.com/users/${encodeURIComponent(githubLogin)}/received_events?per_page=100`,
  ];

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let lastError: Error | undefined;

  for (const startUrl of startUrls) {
    let url: string | null = startUrl;

    while (url !== null) {
      const { events, nextUrl, rateLimit } = await fetchGitHubPage(url, accessToken);

      totalFetched += events.length;

      // Filter to the lookback window
      const recent = events.filter((e) => new Date(e.created_at) >= since);

      // If no events in this page are within the window, stop paginating —
      // events are newest-first so earlier pages won't have newer events.
      if (recent.length === 0 && events.length > 0) {
        break;
      }

      for (const event of recent) {
        // Per-integration repo allowlist (FUL-82): skip non-allowlisted repos.
        // `event.repo.name` is the full `owner/repo` name from the Events API.
        if (!isRepoAllowed(config, event.repo?.name)) {
          totalSkipped++;
          continue;
        }

        // Isolate per-event failures: a single malformed event (unexpected
        // Events API shape, transient insert error) must not abort the whole
        // catchup run and silently drop every subsequent event.
        try {
          const activity = normalizeGitHubEvent(enrichPayload(event), userId);

          if (activity === null) {
            totalSkipped++;
            continue;
          }

          const [inserted] = await db
            .insert(schema.activityEvents)
            .values({
              id: activity.id,
              userId,
              integrationId,
              provider: 'github',
              eventType: activity.eventType,
              externalId: activity.sourceId,
              title: activity.title,
              url: activity.url,
              metadata: activity.metadata,
              occurredAt: new Date(activity.occurredAt),
            })
            .onConflictDoNothing({
              target: [schema.activityEvents.integrationId, schema.activityEvents.externalId],
            })
            .returning({ id: schema.activityEvents.id });

          if (inserted) {
            totalInserted++;
          } else {
            totalSkipped++;
          }
        } catch (err) {
          // Count as skipped and surface context without aborting the loop.
          totalSkipped++;
          totalErrors++;
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      // Respect rate limits before the next page request
      await respectRateLimit(rateLimit);

      url = nextUrl;
    }
  }

  return {
    fetched: totalFetched,
    inserted: totalInserted,
    skipped: totalSkipped,
    errors: totalErrors,
    ...(lastError ? { lastError } : {}),
  };
}

// ---------------------------------------------------------------------------
// Payload enrichment
// ---------------------------------------------------------------------------

/**
 * The GitHub Events API wraps payloads differently from webhook payloads.
 * This function reconstructs a shape the normalizer can consume.
 *
 * Webhook payload shape:  { action, pull_request, repository, sender }
 * Events API payload:     { event.type, event.payload, event.repo, event.actor }
 *
 * We synthesise missing fields from the event envelope so the normalizer
 * receives what it expects.
 */
function enrichPayload(event: GitHubEvent): Record<string, unknown> {
  // Read the event envelope defensively: the Events API can return items with
  // a missing `actor` (ghost / deleted accounts) or `repo`. Unguarded access
  // here (e.g. `event.actor.login`) was the FUL-89 crash. Fall back to `null`
  // so the normalizer's already-null-safe reads (sender, pusher) handle them.
  const actor = event.actor ?? null;
  const repoName = event.repo?.name ?? null;

  const base: Record<string, unknown> = {
    ...event.payload,
    repository:
      event.payload['repository'] ??
      (repoName != null
        ? { full_name: repoName, html_url: `https://github.com/${repoName}` }
        : null),
    sender:
      event.payload['sender'] ?? (actor != null ? { login: actor.login, id: actor.id } : null),
  };

  if (event.type === 'PushEvent') {
    // Events API uses `head` for the post-push SHA; normalizer expects `after`
    if (!base['after'] && base['head']) {
      base['after'] = base['head'];
    }

    // Events API commit objects use `sha` (not `id`) and have no `timestamp`.
    // Normalizer reads `commit.id`, `commit.timestamp`, and `commit.url`.
    const rawCommits = base['commits'];
    if (Array.isArray(rawCommits)) {
      base['commits'] = rawCommits.map((c: Record<string, unknown>) => ({
        ...c,
        id: c['id'] ?? c['sha'],
        timestamp: c['timestamp'] ?? event.created_at,
        url:
          c['url'] ??
          (repoName != null
            ? `https://github.com/${repoName}/commit/${String(c['sha'] ?? c['id'])}`
            : null),
      }));
    }

    if (!base['pusher']) {
      base['pusher'] = actor != null ? { name: actor.login } : null;
    }
  }

  return base;
}
