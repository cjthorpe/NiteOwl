// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Shared window resolution for activity-backed surfaces (feed + morning
 * briefing).
 *
 * Two windowing modes exist, and they filter on *different* time axes:
 *
 * - `?since=last_login` — "what's new to me since I was last here." This is an
 *   *ingestion* concept: it must include events that an overnight catch-up
 *   backfilled this morning even though they happened on the provider (GitHub,
 *   Linear, …) days ago. So it filters on `ingested_at`. Filtering on
 *   `occurred_at` here is the FUL-142 bug: a 06:00 catch-up ingests events whose
 *   provider timestamps predate the user's last login, so an `occurred_at`
 *   window silently drops them and the briefing shows "all quiet" despite fresh
 *   items on the dashboard.
 *
 * - `?hours=N` (and the first-session fallback) — "activity that happened in the
 *   last N hours." This is a temporal view of provider activity, so it filters
 *   on `occurred_at`, matching the dashboard's "last 24h" button.
 *
 * Pure: no I/O. Callers translate `byIngestion` into the concrete Drizzle
 * column so the SQL and its indexes stay in the route layer.
 */

export const DEFAULT_WINDOW_HOURS = 8;
export const MAX_WINDOW_HOURS = 72;

export interface ActivityWindow {
  /** Inclusive lower bound for the chosen time column. */
  since: Date;
  /**
   * When true, filter on `ingested_at` (the "new to me since last login"
   * window). When false, filter on `occurred_at` (the temporal `hours` window).
   */
  byIngestion: boolean;
  /**
   * Effective window size in whole hours. Used for cache keys and telemetry;
   * for the `last_login` case it is derived from the resolved `since`.
   */
  hours: number;
}

export interface ActivityWindowQuery {
  hours?: string;
  since?: string;
}

/**
 * Resolve the window start and the time axis to filter on.
 *
 * @param query          The request querystring (`since` / `hours`).
 * @param lastSeenAt     The JWT's snapshotted previous-session timestamp.
 * @param now            Injected clock for deterministic tests; defaults to
 *                       `Date.now()`.
 */
export function resolveActivityWindow(
  query: ActivityWindowQuery,
  lastSeenAt: string | null | undefined,
  now: number = Date.now(),
): ActivityWindow {
  if (query.since === 'last_login' && lastSeenAt) {
    const since = new Date(lastSeenAt);
    const hours = Math.max(1, Math.ceil((now - since.getTime()) / (60 * 60 * 1000)));
    return { since, byIngestion: true, hours };
  }

  const hoursRaw = Number.parseInt(query.hours ?? String(DEFAULT_WINDOW_HOURS), 10);
  const hours =
    Number.isNaN(hoursRaw) || hoursRaw < 1
      ? DEFAULT_WINDOW_HOURS
      : Math.min(hoursRaw, MAX_WINDOW_HOURS);
  return { since: new Date(now - hours * 60 * 60 * 1000), byIngestion: false, hours };
}
