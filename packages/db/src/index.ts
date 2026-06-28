// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import path from 'path';
import { fileURLToPath } from 'url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from './schema';

export { schema };
export {
  encrypt,
  decrypt,
  encryptOptional,
  decryptOptional,
  isEncrypted,
  decryptToken,
  decryptTokenOptional,
} from './encryption.js';

export type {
  ActivityEvent,
  Integration,
  NewActivityEvent,
  NewIntegration,
  NewOauthToken,
  NewPasswordResetToken,
  NewPersonalAccessToken,
  NewRefreshToken,
  NewSlackAlertConfig,
  NewUser,
  NewWebhookEvent,
  OauthToken,
  PasswordResetToken,
  PersonalAccessToken,
  Plan,
  RefreshToken,
  SlackAlertConfig,
  User,
  WebhookEvent,
  WebhookEventStatus,
} from './schema';

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run all pending Drizzle migrations against the given database URL.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, '../migrations');
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
