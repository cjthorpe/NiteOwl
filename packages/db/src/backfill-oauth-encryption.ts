// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Backfill: encrypt legacy plaintext OAuth tokens (FUL-135).
 *
 * Historically `oauth_tokens.access_token_encrypted` /
 * `refresh_token_encrypted` stored the *raw* token despite the column names.
 * The write/read paths now AES-256-GCM encrypt at the app layer. This script
 * re-encrypts any rows still holding plaintext so the at-rest exposure is
 * closed for existing installs.
 *
 * AES-256-GCM cannot be expressed in plain SQL (random IV + auth tag + the
 * `iv.ct.tag` wire format), so this runs as a Node script rather than a `.sql`
 * migration.
 *
 * Idempotent: rows already in ciphertext form ({@link isEncrypted}) are
 * skipped, so the script is safe to run repeatedly and safe to run before all
 * app instances have been upgraded.
 *
 *   DATABASE_URL=... DB_ENCRYPTION_KEY=... pnpm --filter @niteowl/db db:backfill:oauth-encryption
 */
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { encrypt, isEncrypted } from './encryption.js';
import * as schema from './schema';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://niteowl:niteowl_dev_password@localhost:5432/niteowl';

interface BackfillStats {
  scanned: number;
  accessEncrypted: number;
  refreshEncrypted: number;
  alreadyEncrypted: number;
}

/**
 * Encrypt the field if it holds legacy plaintext; return the value to persist
 * plus whether a change occurred. Values that are null/empty or already
 * ciphertext are returned unchanged — this is what makes the backfill
 * idempotent. Exported for unit testing.
 */
export function maybeEncrypt(value: string | null): { next: string | null; changed: boolean } {
  if (value == null || value === '' || isEncrypted(value)) {
    return { next: value, changed: false };
  }
  return { next: encrypt(value), changed: true };
}

export async function backfillOauthEncryption(
  db: PostgresJsDatabase<typeof schema>,
): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    accessEncrypted: 0,
    refreshEncrypted: 0,
    alreadyEncrypted: 0,
  };

  const rows = await db
    .select({
      id: schema.oauthTokens.id,
      accessTokenEncrypted: schema.oauthTokens.accessTokenEncrypted,
      refreshTokenEncrypted: schema.oauthTokens.refreshTokenEncrypted,
    })
    .from(schema.oauthTokens);

  for (const row of rows) {
    stats.scanned += 1;

    const access = maybeEncrypt(row.accessTokenEncrypted);
    const refresh = maybeEncrypt(row.refreshTokenEncrypted);

    if (!access.changed && !refresh.changed) {
      stats.alreadyEncrypted += 1;
      continue;
    }

    const updates: { accessTokenEncrypted?: string; refreshTokenEncrypted?: string | null } = {};
    if (access.changed && access.next != null) {
      updates.accessTokenEncrypted = access.next;
      stats.accessEncrypted += 1;
    }
    if (refresh.changed) {
      updates.refreshTokenEncrypted = refresh.next;
      stats.refreshEncrypted += 1;
    }

    await db.update(schema.oauthTokens).set(updates).where(eq(schema.oauthTokens.id, row.id));
  }

  return stats;
}

async function main(): Promise<void> {
  // Fail fast if the key is missing rather than writing half the rows.
  encrypt('__backfill_preflight__');

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    console.log('[backfill-oauth-encryption] starting…');
    const stats = await backfillOauthEncryption(db);
    console.log(
      `[backfill-oauth-encryption] done: scanned=${stats.scanned} ` +
        `access_encrypted=${stats.accessEncrypted} refresh_encrypted=${stats.refreshEncrypted} ` +
        `already_encrypted=${stats.alreadyEncrypted}`,
    );
  } finally {
    await client.end();
  }
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error('[backfill-oauth-encryption] failed:', err);
    process.exit(1);
  });
}
