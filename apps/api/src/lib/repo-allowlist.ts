/**
 * Per-integration repository allowlist (FUL-82).
 *
 * NiteOwl is an account-wide GitHub aggregator by default. When an integration
 * configures a non-empty `repoAllowlist`, only events whose repository is on the
 * list are ingested. An empty or unset allowlist preserves the current behaviour
 * (allow all) so the feature is fully backward-compatible.
 *
 * This is the single source of truth for allowlist matching. All three ingestion
 * paths — webhook, Events API sync, and repo-scan catch-up — call `isRepoAllowed`
 * so behaviour cannot drift between them.
 */

/** Shape of the relevant slice of `integrations.configJson`. */
export interface RepoAllowlistConfig {
  repoAllowlist?: unknown;
}

/**
 * Normalises a raw `configJson.repoAllowlist` value into a clean string array.
 *
 * Accepts the stored config (which may be `null`, malformed, or contain
 * non-string / blank entries) and returns lower-cased, trimmed, de-duplicated
 * `owner/repo` (or `owner/*`) patterns. Non-array or empty input yields `[]`,
 * which `isRepoAllowed` treats as "allow all".
 */
export function parseRepoAllowlist(config: RepoAllowlistConfig | null | undefined): string[] {
  const raw = config?.repoAllowlist;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().toLowerCase();
    if (normalized.length === 0) continue;
    seen.add(normalized);
  }

  return [...seen];
}

/**
 * Returns true when an event from `repoFullName` should be ingested for an
 * integration with the given config.
 *
 * Rules:
 *  - Empty / unset allowlist  → allow all (non-breaking default).
 *  - Exact match              → case-insensitive on the full `owner/repo` name.
 *  - Org wildcard `owner/*`   → allows every repo under `owner`.
 *
 * A missing or malformed `repoFullName` is rejected whenever an allowlist is
 * active (we cannot prove it is allowed), but allowed when no allowlist is set.
 */
export function isRepoAllowed(
  config: RepoAllowlistConfig | null | undefined,
  repoFullName: string | null | undefined,
): boolean {
  const allowlist = parseRepoAllowlist(config);

  // No allowlist configured — preserve account-wide aggregation.
  if (allowlist.length === 0) return true;

  if (typeof repoFullName !== 'string') return false;
  const target = repoFullName.trim().toLowerCase();
  if (target.length === 0) return false;

  const owner = target.slice(0, target.indexOf('/'));

  for (const pattern of allowlist) {
    if (pattern === target) return true;
    // Org-wide wildcard: "owner/*" matches any repo under that owner.
    if (pattern.endsWith('/*') && owner.length > 0 && pattern.slice(0, -2) === owner) {
      return true;
    }
  }

  return false;
}
