// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createDb, schema } from '@niteowl/db';
import type { HealthStatus } from '@niteowl/types';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';

import { register, setIngestionLag, setQueueDepth } from './lib/metrics.js';
import authPlugin from './plugins/auth.js';
import queuePlugin from './plugins/queue.js';
import redisPlugin from './plugins/redis.js';
import { agentLoginRoutes } from './routes/agent-logins/index.js';
import { authRoutes } from './routes/auth/index.js';
import { briefingRoutes } from './routes/briefing/index.js';
import { feedRoutes } from './routes/feed/index.js';
import { integrationsRoutes } from './routes/integrations/index.js';
import { slackAlertRoutes } from './routes/slack-alerts/index.js';
import { usersRoutes } from './routes/users/index.js';
import { githubWebhookRoutes } from './routes/webhooks/github.js';
import { jiraWebhookRoutes } from './routes/webhooks/jira.js';
import { linearWebhookRoutes } from './routes/webhooks/linear.js';

export interface BuildAppOptions {
  /** Injected in tests; production uses DATABASE_URL env var */
  db?: ReturnType<typeof createDb>;
}

export function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      // Redact sensitive values from all log output — tokens must never appear in logs.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  // ── Security: CORS ─────────────────────────────────────────────────────────
  void app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true, // required for cross-origin cookie sending
    // @fastify/cors v11 defaults `methods` to 'GET,HEAD,POST', which omits the
    // verbs our API relies on. Without DELETE the browser preflight blocks the
    // agent-login Remove button (FUL-79); PATCH routes are affected too. List
    // every method we actually serve so cross-origin requests aren't rejected.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Security: Cookie plugin ────────────────────────────────────────────────
  // Signed cookies via HMAC — prevents client-side tampering with cookie values.
  const cookieSecret = process.env['COOKIE_SECRET'] ?? process.env['JWT_SECRET'];
  void app.register(cookie, {
    ...(cookieSecret !== undefined ? { secret: cookieSecret } : {}),
    parseOptions: {},
  });

  // ── Security: Rate limiting ────────────────────────────────────────────────
  // Global default: 200 req / min per IP.
  // Auth routes register tighter limits (e.g. 10 req / min) via config.rateLimit.
  void app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    // Suppress detailed rate-limit headers to avoid leaking internal thresholds
    addHeadersOnExceeding: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
    },
  });

  // ── DB ─────────────────────────────────────────────────────────────────────
  // Created before the auth plugin so the PAT branch can look tokens up.
  const db =
    opts.db ??
    createDb(process.env['DATABASE_URL'] ?? 'postgres://niteowl:niteowl@localhost:5432/niteowl');

  // ── Auth: JWT / PAT decode + request.user decoration ──────────────────────
  void app.register(authPlugin, { db });

  // ── Redis: caching layer ───────────────────────────────────────────────────
  void app.register(redisPlugin);

  // ── BullMQ: normalization queue + worker ──────────────────────────────────
  // Only wired up in production (when no injected mock db is present).
  // In test mode the queue remains undefined; webhook handlers acknowledge
  // without processing — matching their existing behaviour.
  const enableQueue = !opts.db;
  if (enableQueue) {
    void app.register(queuePlugin, { db });
  }

  // ── Security: HTTP security headers ───────────────────────────────────────
  app.addHook('onSend', (_request, reply, _payload, done) => {
    void reply.header('X-Content-Type-Options', 'nosniff');
    void reply.header('X-Frame-Options', 'DENY');
    void reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    void reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Strict CSP for the JSON API — no scripts are served from this origin.
    void reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'self'",
    );
    if (process.env['NODE_ENV'] === 'production') {
      void reply.header(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }
    done();
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  const healthHandler = async (): Promise<HealthStatus> => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: { db: 'ok', redis: 'ok' },
  });

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // ── Observability: Prometheus metrics (FUL-145) ───────────────────────────
  // Registered next to /health, unauthenticated (scraped by Prometheus). Two
  // series are sampled at scrape time; both are wrapped defensively so a DB or
  // Redis hiccup degrades to stale/zero gauges rather than failing the scrape:
  //  - ingestion_lag_seconds  ← seconds since max(ingested_at)  (FUL-142)
  //  - ingestion_queue_depth  ← BullMQ getJobCounts() per ingestion queue
  app.get('/metrics', async (_request, reply) => {
    try {
      const [row] = await db
        .select({ max: sql<string | null>`max(${schema.activityEvents.ingestedAt})` })
        .from(schema.activityEvents);
      setIngestionLag(row?.max ? new Date(row.max) : null);
    } catch (err) {
      app.log.warn({ err }, '[metrics] failed to sample ingestion lag');
    }

    // The queue decorations only exist when the BullMQ plugin is wired
    // (production). In test mode they are undefined and simply skipped.
    const ingestionQueues: Array<
      [string, { getJobCounts: () => Promise<Record<string, number>> } | null | undefined]
    > = [
      [
        'overnight-catchup',
        app.hasDecorator('overnightCatchupQueue') ? app.overnightCatchupQueue : null,
      ],
      ['normalization', app.hasDecorator('normalizationQueue') ? app.normalizationQueue : null],
    ];
    for (const [name, queue] of ingestionQueues) {
      if (!queue) continue;
      try {
        setQueueDepth(name, await queue.getJobCounts());
      } catch (err) {
        app.log.warn({ err, queue: name }, '[metrics] failed to sample queue depth');
      }
    }

    return reply.header('Content-Type', register.contentType).send(await register.metrics());
  });

  // Auth routes — stricter rate limits applied per-route via config.rateLimit
  void app.register(authRoutes, { prefix: '/auth', db });

  // Feed + integrations API
  void app.register(feedRoutes, { prefix: '/api/feed', db });
  void app.register(integrationsRoutes, { prefix: '/api/integrations', db });

  // Morning-briefing digest (heuristic + optional server-side LLM enhancement)
  void app.register(briefingRoutes, { prefix: '/api/briefing', db });

  // Webhook receivers — no auth, secured by provider-specific signatures.
  // GitHub handler is registered inside app.after() so the queue decoration
  // from queuePlugin is available when opts are read by the plugin.
  app.after(() => {
    const rawQueue = enableQueue
      ? ((
          app as unknown as {
            normalizationQueue:
              | import('bullmq').Queue<import('@niteowl/types').NormalizationJobData>
              | null;
          }
        ).normalizationQueue ?? undefined)
      : undefined;

    void app.register(githubWebhookRoutes, {
      prefix: '/api/webhooks/github',
      db,
      ...(rawQueue != null ? { queue: rawQueue } : {}),
    });
  });
  void app.register(linearWebhookRoutes, { prefix: '/api/webhooks', db });
  void app.register(jiraWebhookRoutes, { prefix: '/api/webhooks', db });

  // Slack alert configuration
  void app.register(slackAlertRoutes, { prefix: '/api/slack-alerts', db });

  // Agent login registry
  void app.register(agentLoginRoutes, { prefix: '/api/agent-logins', db });

  // User profile (JWT-derived, no DB hit)
  void app.register(usersRoutes, { prefix: '/api/users' });

  return app;
}
