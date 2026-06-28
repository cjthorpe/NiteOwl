// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { BriefingDigest, BriefingHighlight } from './briefing-digest';
import { authedFetch } from './auth';

/**
 * Client for the optional server-side briefing digest (FUL-136).
 *
 * The server may enhance the digest with an LLM rewrite; when it does the shape
 * is identical to the local heuristic ({@link BriefingDigest}). This fetch is
 * TOTAL — it resolves to `null` on any failure (network, non-2xx, unexpected
 * body) so the caller transparently falls back to the local heuristic with no
 * visible regression when the LLM (or the endpoint) is unavailable.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

/** The server adds a `source` discriminator to the heuristic shape. */
export interface ServerBriefingDigest extends BriefingDigest {
  source: 'llm' | 'heuristic';
}

function isHighlight(value: unknown): value is BriefingHighlight {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BriefingHighlight).kind === 'string' &&
    typeof (value as BriefingHighlight).text === 'string'
  );
}

/** Narrow an untrusted response body to a usable digest, or null. */
function parseDigest(body: unknown): ServerBriefingDigest | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record['headline'] !== 'string') return null;
  if (!Array.isArray(record['highlights'])) return null;
  if (!record['highlights'].every(isHighlight)) return null;
  const source = record['source'] === 'llm' ? 'llm' : 'heuristic';
  return {
    headline: record['headline'],
    highlights: record['highlights'] as BriefingHighlight[],
    source,
  };
}

/**
 * Fetch the server-computed briefing digest for the last-login window.
 * Returns null (never throws) so callers can fall back to the local heuristic.
 */
export async function fetchServerBriefingDigest(): Promise<ServerBriefingDigest | null> {
  try {
    const url = new URL(`${API_URL}/api/briefing/digest`);
    url.searchParams.set('since', 'last_login');
    const res = await authedFetch(url.toString());
    if (!res.ok) return null;
    return parseDigest(await res.json());
  } catch {
    return null;
  }
}
