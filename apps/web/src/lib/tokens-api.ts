/**
 * API client for Personal Access Tokens (FUL-93), backed by the PAT endpoints
 * from FUL-91. Uses `authedFetch` so calls self-heal on a stale access token.
 *
 *   GET    /auth/tokens       → { data: { tokens: PersonalAccessToken[] } }
 *   POST   /auth/tokens       → { data: CreatedToken }   (raw token, ONCE)
 *   DELETE /auth/tokens/:id   → { success: true }
 *
 * The raw `niteowl_pat_…` value is only ever present on the create response and
 * is never persisted or re-fetched — the list endpoint returns metadata only.
 */

import { authedFetch } from './auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

/** Token metadata as returned by the list endpoint — never includes the value. */
export interface PersonalAccessToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Create response — the only place the raw `token` is ever exposed. */
export interface CreatedToken {
  id: string;
  name: string;
  expiresAt: string | null;
  createdAt: string;
  token: string;
}

export interface CreateTokenInput {
  name: string;
  /** Days until expiry; omit for a non-expiring token. */
  expiresInDays?: number;
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

/** List the authed user's active (non-revoked) tokens, newest first. */
export async function listTokens(): Promise<PersonalAccessToken[]> {
  const res = await authedFetch(`${API_URL}/auth/tokens`);
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { data: { tokens: PersonalAccessToken[] } };
  return body.data.tokens;
}

/** Mint a new token. The returned `token` is shown once and never recoverable. */
export async function createToken(input: CreateTokenInput): Promise<CreatedToken> {
  const res = await authedFetch(`${API_URL}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { data: CreatedToken };
  return body.data;
}

/** Revoke (soft-delete) a token by id. */
export async function revokeToken(id: string): Promise<void> {
  const res = await authedFetch(`${API_URL}/auth/tokens/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorMessage(res));
}
