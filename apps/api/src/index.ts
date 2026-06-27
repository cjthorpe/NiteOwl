// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { runMigrations } from '@niteowl/db';
import { buildApp } from './app.js';
import { missingEmailConfig } from './lib/email.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://niteowl:niteowl_dev_password@localhost:5432/niteowl';
const PORT = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? process.env['API_HOST'] ?? '0.0.0.0';

async function start() {
  // The password-reset flow depends on email transport. In production we fail
  // fast so a broken deploy never accepts traffic. In dev/test the env vars are
  // optional — but a misconfigured non-prod deployment would otherwise drop
  // every reset email silently (the route logs and swallows the send failure to
  // avoid leaking whether an account exists), which is exactly how such issues
  // reach us as "reset email not received". So we always surface it at boot:
  // hard-fail in production, loud warning everywhere else.
  const missingEmail = missingEmailConfig();
  if (missingEmail.length > 0) {
    const detail = `email transport unconfigured — missing env: ${missingEmail.join(', ')}. Password reset emails will NOT be sent.`;
    if (process.env['NODE_ENV'] === 'production') {
      console.error(`[startup] ${detail} Cannot start.`);
      process.exit(1);
    }
    console.warn(
      `[startup] WARNING: ${detail} Set RESEND_API_KEY and RESEND_FROM to enable delivery.`,
    );
  }

  // Run all pending migrations before accepting traffic. Already-applied
  // migrations are skipped, so this is safe to call on every startup.
  try {
    await runMigrations(DATABASE_URL);
    console.log('[migrate] All migrations applied.');
  } catch (err) {
    console.error('[migrate] Migration failed — cannot start:', err);
    process.exit(1);
  }

  const app = buildApp();

  app.listen({ port: PORT, host: HOST }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

start().catch((err: unknown) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
