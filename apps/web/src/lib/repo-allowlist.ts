// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Client-side repo allowlist helpers (FUL-83).
 *
 * Mirrors the backend's normalization semantics (trim → lowercase → dedupe)
 * from `apps/api/src/lib/repo-allowlist.ts` so the Settings UI can validate and
 * preview entries before they are sent to `PATCH /api/integrations/:id`. The
 * backend remains the source of truth — GET returns the normalised values, and
 * the UI re-derives them here so what the user sees matches what is stored.
 *
 * Supported entry shapes (matching the backend matcher):
 *   - `owner/repo`  exact repository
 *   - `owner/*`     every repo under an owner (org-wide wildcard)
 *
 * An empty allowlist means "ingest all repositories account-wide" — the current
 * default behaviour — so clearing every entry restores account-wide aggregation.
 */

/**
 * GitHub owner + repo segments are intentionally permissive but reject the
 * obviously-invalid: empty segments, spaces, or anything that isn't a single
 * `owner/repo` (or `owner/*`) pair. Owners are alphanumeric with single hyphens;
 * repo names additionally allow dots and underscores; `*` is the wildcard repo.
 */
const OWNER = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const REPO = '[a-z0-9._-]+';
const ENTRY_RE = new RegExp(`^${OWNER}/(?:${REPO}|\\*)$`);

/** Trim + lowercase a single entry to match backend normalization. */
export function normalizeEntry(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True when a normalized entry is a valid `owner/repo` or `owner/*` pattern. */
export function isValidEntry(entry: string): boolean {
  return ENTRY_RE.test(entry);
}

/** True when an entry is an org-wide wildcard (`owner/*`). */
export function isWildcardEntry(entry: string): boolean {
  return entry.endsWith('/*');
}

/**
 * Normalise + dedupe a list of entries, preserving first-seen order.
 * Blank entries are dropped. Does not validate — callers validate separately so
 * they can surface a specific error for the offending input.
 */
export function normalizeAllowlist(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entries) {
    const normalized = normalizeEntry(raw);
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Split a raw input string into candidate entries. Accepts commas, whitespace,
 * and newlines as separators so users can paste a list or type one at a time.
 */
export function splitInput(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

/** True when two allowlists are equal as sets (after normalization). */
export function allowlistsEqual(a: readonly string[], b: readonly string[]): boolean {
  const na = normalizeAllowlist(a);
  const nb = normalizeAllowlist(b);
  if (na.length !== nb.length) return false;
  const setB = new Set(nb);
  return na.every((e) => setB.has(e));
}
