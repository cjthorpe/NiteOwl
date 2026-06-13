import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { HealthStatus } from "@niteowl/types";
import { createDb } from "@niteowl/db";
import authPlugin from "./plugins/auth.js";
import queuePlugin from "./plugins/queue.js";
import redisPlugin from "./plugins/redis.js";
import { authRoutes } from "./routes/auth/index.js";
import { feedRoutes } from "./routes/feed/index.js";
import { integrationsRoutes } from "./routes/integrations/index.js";
import { githubWebhookRoutes } from "./routes/webhooks/github.js";
import { jiraWebhookRoutes } from "./routes/webhooks/jira.js";
import { linearWebhookRoutes } from "./routes/webhooks/linear.js";
import { slackAlertRoutes } from "./routes/slack-alerts/index.js";

export interface BuildAppOptions {
  /** Injected in tests; production uses DATABASE_URL env var */
  db?: ReturnType<typeof createDb>;
}

export function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      // Redact sensitive values from all log output — tokens must never appear in logs.
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
      ],
    },
  });

  // ── Security: CORS ─────────────────────────────────────────────────────────
  app.register(cors, {
    origin: process.env["CORS_ORIGIN"] ?? "http://localhost:5173",
    credentials: true, // required for cross-origin cookie sending
  });

  // ── Security: Cookie plugin ────────────────────────────────────────────────
  // Signed cookies via HMAC — prevents client-side tampering with cookie values.
  const cookieSecret = process.env["COOKIE_SECRET"] ?? process.env["JWT_SECRET"];
  app.register(cookie, {
    ...(cookieSecret !== undefined ? { secret: cookieSecret } : {}),
    parseOptions: {},
  });

  // ── Security: Rate limiting ────────────────────────────────────────────────
  // Global default: 200 req / min per IP.
  // Auth routes register tighter limits (e.g. 10 req / min) via config.rateLimit.
  app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
    // Suppress detailed rate-limit headers to avoid leaking internal thresholds
    addHeadersOnExceeding: {
      "x-ratelimit-limit": false,
      "x-ratelimit-remaining": false,
      "x-ratelimit-reset": false,
    },
  });

  // ── Auth: JWT decode + request.user decoration ────────────────────────────
  app.register(authPlugin);

  // ── Redis: caching layer ───────────────────────────────────────────────────
  app.register(redisPlugin);

  // ── DB ─────────────────────────────────────────────────────────────────────
  const db =
    opts.db ??
    createDb(
      process.env["DATABASE_URL"] ??
        "postgres://niteowl:niteowl@localhost:5432/niteowl",
    );

  // ── BullMQ: normalization queue + worker ──────────────────────────────────
  // Only wired up in production (when no injected mock db is present).
  // In test mode the queue remains undefined; webhook handlers acknowledge
  // without processing — matching their existing behaviour.
  const enableQueue = !opts.db;
  if (enableQueue) {
    app.register(queuePlugin, { db });
  }

  // ── Security: HTTP security headers ───────────────────────────────────────
  app.addHook("onSend", (_request, reply, _payload, done) => {
    void reply.header("X-Content-Type-Options", "nosniff");
    void reply.header("X-Frame-Options", "DENY");
    void reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    void reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    // Strict CSP for the JSON API — no scripts are served from this origin.
    void reply.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'self'",
    );
    if (process.env["NODE_ENV"] === "production") {
      void reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      );
    }
    done();
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  const healthHandler = async (): Promise<HealthStatus> => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: { db: "ok", redis: "ok" },
  });

  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  // Auth routes — stricter rate limits applied per-route via config.rateLimit
  app.register(authRoutes, { prefix: "/auth", db });

  // Feed + integrations API
  app.register(feedRoutes, { prefix: "/api/feed", db });
  app.register(integrationsRoutes, { prefix: "/api/integrations", db });

  // Webhook receivers — no auth, secured by provider-specific signatures.
  // GitHub handler is registered inside app.after() so the queue decoration
  // from queuePlugin is available when opts are read by the plugin.
  app.after(() => {
    const rawQueue = enableQueue
      ? ((app as unknown as { normalizationQueue: import("bullmq").Queue<import("@niteowl/types").NormalizationJobData> | null })
          .normalizationQueue ?? undefined)
      : undefined;

    app.register(githubWebhookRoutes, {
      prefix: "/api/webhooks/github",
      db,
      ...(rawQueue != null ? { queue: rawQueue } : {}),
    });
  });
  app.register(linearWebhookRoutes, { prefix: "/api/webhooks", db });
  app.register(jiraWebhookRoutes, { prefix: "/api/webhooks", db });

  // Slack alert configuration
  app.register(slackAlertRoutes, { prefix: "/api/slack-alerts", db });

  return app;
}
