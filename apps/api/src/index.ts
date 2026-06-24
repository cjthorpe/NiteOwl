import { runMigrations } from '@niteowl/db';
import { buildApp } from './app.js';
import { assertEmailConfigured } from './lib/email.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://niteowl:niteowl_dev_password@localhost:5432/niteowl';
const PORT = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? process.env['API_HOST'] ?? '0.0.0.0';

async function start() {
  // Fail fast in production if email transport is unconfigured — the password
  // reset flow depends on it. In dev/test the env vars are optional.
  if (process.env['NODE_ENV'] === 'production') {
    try {
      assertEmailConfigured();
    } catch (err) {
      console.error('[startup] Email transport misconfigured — cannot start:', err);
      process.exit(1);
    }
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
