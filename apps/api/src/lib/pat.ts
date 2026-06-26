/**
 * Personal Access Token (PAT) helpers — FUL-91.
 *
 * PATs are opaque, DB-backed Bearer tokens that let any logged-in user (incl.
 * OAuth-only accounts with no password) authenticate headless/CLI/curl requests
 * with server-side revocation. They mirror the refresh_tokens idiom: the raw
 * token is shown once and only its SHA-256 fingerprint is persisted.
 *
 * The raw token carries the `niteowl_pat_` prefix so the auth plugin can cheaply
 * tell a PAT apart from a JWT before doing any DB lookup or signature check —
 * which also prevents PATs from being fed into the JWT verifier as a probe.
 */
import { and, eq, gt, isNull, or } from 'drizzle-orm';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { generateOpaqueToken, sha256 } from './crypto.js';
import type { TokenPayload } from './jwt.js';

/** Distinguishes a PAT from a JWT in the `Authorization: Bearer …` header. */
export const PAT_PREFIX = 'niteowl_pat_';

/**
 * Only bump `last_used_at` if the stored value is older than this. Avoids a DB
 * write on every single authenticated request from a busy token.
 */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** True when the Bearer value is shaped like a PAT (cheap prefix check). */
export function isPatToken(token: string): boolean {
  return token.startsWith(PAT_PREFIX);
}

/** Mint a fresh raw PAT, e.g. `niteowl_pat_<base64url(32 bytes)>`. */
export function generatePatToken(): string {
  return `${PAT_PREFIX}${generateOpaqueToken()}`;
}

/**
 * Verify a raw PAT against the database.
 *
 * Returns a `TokenPayload`-shaped object (so every `requireAuth` /
 * `request.user!.sub` consumer works unchanged) when the token is valid, or
 * `null` when it is unknown, revoked, or expired. Side-effect: throttled bump
 * of `last_used_at`, fire-and-forget so it never blocks or fails the request.
 */
export async function verifyPatToken(db: Db, rawToken: string): Promise<TokenPayload | null> {
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const [row] = await db
    .select({
      id: schema.personalAccessTokens.id,
      userId: schema.personalAccessTokens.userId,
      lastUsedAt: schema.personalAccessTokens.lastUsedAt,
      email: schema.users.email,
    })
    .from(schema.personalAccessTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.personalAccessTokens.userId))
    .where(
      and(
        eq(schema.personalAccessTokens.tokenHash, tokenHash),
        // Revoked tokens are rejected.
        isNull(schema.personalAccessTokens.revokedAt),
        // Null expiry = never expires; otherwise must still be in the future.
        or(
          isNull(schema.personalAccessTokens.expiresAt),
          gt(schema.personalAccessTokens.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Throttled last-used bump — only when stale, fire-and-forget.
  const lastUsed = row.lastUsedAt ? row.lastUsedAt.getTime() : 0;
  if (now.getTime() - lastUsed > LAST_USED_THROTTLE_MS) {
    void db
      .update(schema.personalAccessTokens)
      .set({ lastUsedAt: now })
      .where(eq(schema.personalAccessTokens.id, row.id))
      .catch(() => {
        // Best-effort metadata; never fail auth on a bump error.
      });
  }

  return { sub: row.userId, email: row.email, lastSeenAt: null };
}
