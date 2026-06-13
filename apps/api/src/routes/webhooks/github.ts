import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { Readable } from "node:stream";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";

import { normalizeGitHubEvent } from "../../normalizers/github.js";
import { invalidateFeedCache } from "../feed/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubWebhookPayload {
  sender?: { id: number; login: string };
  repository?: { full_name: string };
  installation?: { id: number; account?: { login: string } };
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies the `X-Hub-Signature-256` header against the raw request body.
 * Returns true only when the computed digest matches the provided signature
 * via timing-safe comparison.
 */
export function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  // GitHub sends: "sha256=<hex-digest>"
  if (!signature.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const provided = signature.slice("sha256=".length);

  // timingSafeEqual requires equal-length buffers
  const bufA = Buffer.from(`sha256=${expected}`, "utf8");
  const bufB = Buffer.from(signature, "utf8");
  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// User + integration lookup
// ---------------------------------------------------------------------------

/**
 * Given the GitHub numeric sender ID, resolves the NiteOwl userId and their
 * active GitHub integration ID. Returns null when no matching user/integration
 * is found — callers should log and skip.
 */
async function resolveIntegration(
  db: Db,
  githubUserId: number,
): Promise<{ userId: string; integrationId: string } | null> {
  const githubId = String(githubUserId);

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.githubId, githubId))
    .limit(1);

  if (!user) return null;

  const [integration] = await db
    .select({ id: schema.integrations.id })
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, user.id),
        eq(schema.integrations.provider, "github"),
        eq(schema.integrations.enabled, true),
      ),
    )
    .limit(1);

  if (!integration) return null;

  return { userId: user.id, integrationId: integration.id };
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

function payloadHash(body: Buffer): string {
  return createHmac("sha256", "niteowl-payload-hash").update(body).digest("hex");
}

async function recordWebhookReceived(
  db: Db,
  deliveryId: string | undefined,
  hash: string,
  eventType: string | undefined,
): Promise<string | null> {
  // Attempt insert — silently fails on the unique constraint violation meaning
  // this delivery was already processed.
  const [row] = await db
    .insert(schema.webhookEvents)
    .values({
      provider: "github",
      deliveryId: deliveryId ?? null,
      payloadHash: hash,
      eventType: eventType ?? null,
      status: "received",
    })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });

  return row?.id ?? null;
}

async function markWebhookProcessed(
  db: Db,
  id: string,
  status: "processed" | "failed",
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status, processedAt: new Date() })
    .where(eq(schema.webhookEvents.id, id));
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const githubWebhookRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  // Capture raw body via preParsing so we can compute the HMAC signature
  // against the exact bytes GitHub sent, before Fastify's JSON parser runs.
  fastify.addHook("preParsing", async (_request, _reply, payload) => {
    const chunks: Buffer[] = [];
    const incoming = payload as Readable;

    return new Promise<Readable>((resolve, reject) => {
      incoming.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      incoming.on("error", reject);
      incoming.on("end", () => {
        const raw = Buffer.concat(chunks);
        // Attach raw body to request via type augmentation
        (_request as unknown as Record<string, unknown>)["rawBody"] = raw;

        // Re-emit the same bytes as a fresh Readable for the JSON parser
        const { Readable: NodeReadable } = require("node:stream") as typeof import("node:stream");
        const passthrough = new NodeReadable({ read() {} });
        passthrough.push(raw);
        passthrough.push(null);
        resolve(passthrough as unknown as Readable);
      });
    });
  });

  fastify.post<{
    Headers: {
      "x-hub-signature-256"?: string;
      "x-github-event"?: string;
      "x-github-delivery"?: string;
    };
  }>(
    "/",
    // No auth — public webhook endpoint; security is via HMAC signature
    { config: { rateLimit: { max: 500, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const secret = process.env["GITHUB_WEBHOOK_SECRET"];
      if (!secret) {
        request.log.error("GITHUB_WEBHOOK_SECRET not configured");
        return reply.code(500).send({ error: "Webhook not configured" });
      }

      const rawBody =
        (request as unknown as Record<string, unknown>)["rawBody"] as
          | Buffer
          | undefined;

      if (!rawBody) {
        return reply.code(400).send({ error: "Empty body" });
      }

      // ── Signature verification ──────────────────────────────────────────
      const signature = request.headers["x-hub-signature-256"];
      if (!verifyGitHubSignature(rawBody, signature, secret)) {
        request.log.warn("GitHub webhook signature mismatch");
        return reply.code(401).send({ error: "Invalid signature" });
      }

      const eventType = request.headers["x-github-event"];
      const deliveryId = request.headers["x-github-delivery"];

      // ── Idempotency guard ───────────────────────────────────────────────
      const hash = payloadHash(rawBody);
      const webhookId = await recordWebhookReceived(
        db,
        deliveryId,
        hash,
        eventType,
      );

      if (webhookId === null) {
        // Duplicate delivery — already processed
        request.log.info({ deliveryId }, "Duplicate GitHub webhook delivery — skipping");
        return reply.code(200).send({ ok: true, duplicate: true });
      }

      try {
        const payload = request.body as GitHubWebhookPayload;

        // ── Resolve user + integration from sender.id ─────────────────
        const senderId = payload.sender?.id;
        if (senderId === undefined) {
          request.log.warn({ deliveryId }, "GitHub webhook missing sender.id — skipping");
          await markWebhookProcessed(db, webhookId, "processed");
          return reply.code(200).send({ ok: true });
        }

        const resolved = await resolveIntegration(db, senderId);
        if (!resolved) {
          // No matching active integration — not an error, just not our user
          request.log.debug(
            { senderId },
            "No active GitHub integration for sender — skipping",
          );
          await markWebhookProcessed(db, webhookId, "processed");
          return reply.code(200).send({ ok: true });
        }

        const { userId, integrationId } = resolved;

        // ── Normalize event ───────────────────────────────────────────
        const activity = normalizeGitHubEvent(
          payload as Record<string, unknown>,
          userId,
        );

        if (activity === null) {
          // Unrecognised event type — acknowledged but not ingested
          await markWebhookProcessed(db, webhookId, "processed");
          return reply.code(200).send({ ok: true });
        }

        // ── Persist to activity_events ────────────────────────────────
        await db
          .insert(schema.activityEvents)
          .values({
            id: activity.id,
            userId,
            integrationId,
            provider: "github",
            eventType: activity.eventType,
            externalId: activity.sourceId,
            title: activity.title,
            url: activity.url,
            metadata: activity.metadata,
            occurredAt: new Date(activity.occurredAt),
          })
          .onConflictDoNothing({
            target: [
              schema.activityEvents.integrationId,
              schema.activityEvents.externalId,
            ],
          });

        // ── Invalidate feed cache for this user ───────────────────────
        if (fastify.redis.status === "ready") {
          await invalidateFeedCache(fastify.redis, userId);
        }

        await markWebhookProcessed(db, webhookId, "processed");

        request.log.info(
          { userId, eventType: activity.eventType, deliveryId },
          "GitHub webhook processed",
        );

        return reply.code(200).send({ ok: true });
      } catch (err) {
        await markWebhookProcessed(db, webhookId, "failed");
        request.log.error({ err, webhookId }, "GitHub webhook processing failed");
        return reply.code(500).send({ error: "Processing failed" });
      }
    },
  );
};
