import { createHash, createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";

import { timingSafeCompare } from "../../lib/crypto.js";
import { normalizeLinearEvent } from "../../normalizers/linear.js";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies a Linear webhook HMAC-SHA256 signature.
 *
 * Linear sends the raw hex digest in the `linear-signature` header.
 * We compute HMAC-SHA256(secret, rawBody) and compare timing-safely.
 */
export function verifyLinearSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeCompare(signature, expected);
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Webhook plugin
// ---------------------------------------------------------------------------

export const linearWebhookRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  { db },
) => {
  // Override the JSON content-type parser for this plugin scope so we receive
  // the raw Buffer. This is required because HMAC verification must run on the
  // exact bytes sent by Linear — re-serialising the parsed object would differ.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body as Buffer);
    },
  );

  fastify.post<{ Body: Buffer }>(
    "/linear",
    {
      // Generous limit — webhooks come from Linear's infrastructure, not end-users.
      config: { rateLimit: { max: 500, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const rawBody = request.body;

      // ── 1. Signature verification ──────────────────────────────────────────
      const secret = process.env["LINEAR_WEBHOOK_SECRET"];
      if (!secret) {
        request.log.error(
          "[linear-webhook] LINEAR_WEBHOOK_SECRET not configured",
        );
        return reply.code(500).send({ error: "Webhook not configured" });
      }

      const signature = request.headers["linear-signature"];
      if (typeof signature !== "string" || signature.length === 0) {
        return reply
          .code(400)
          .send({ error: "Missing linear-signature header" });
      }

      if (!verifyLinearSignature(rawBody, signature, secret)) {
        request.log.warn("[linear-webhook] Signature mismatch");
        return reply.code(401).send({ error: "Invalid signature" });
      }

      // ── 2. Parse JSON body ─────────────────────────────────────────────────
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString("utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        return reply.code(400).send({ error: "Invalid JSON payload" });
      }

      // ── 3. Idempotency — record this delivery before any processing ────────
      const payloadHash = sha256Hex(rawBody);
      const eventType =
        typeof payload["type"] === "string" ? payload["type"] : null;

      try {
        await db.insert(schema.webhookEvents).values({
          provider: "linear",
          payloadHash,
          eventType,
          status: "received",
        });
      } catch {
        // Unique constraint on (provider, payloadHash) → duplicate delivery.
        request.log.info(
          { payloadHash },
          "[linear-webhook] Duplicate delivery, acknowledging",
        );
        return reply.code(200).send({ status: "duplicate" });
      }

      // ── 4. Resolve integration from organizationId ─────────────────────────
      const organizationId =
        typeof payload["organizationId"] === "string"
          ? payload["organizationId"]
          : null;

      if (!organizationId) {
        request.log.warn(
          "[linear-webhook] Missing organizationId in payload",
        );
        await markWebhookStatus(db, payloadHash, "failed");
        return reply.code(200).send({ status: "skipped" });
      }

      const [integration] = await db
        .select({ id: schema.integrations.id, userId: schema.integrations.userId })
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.provider, "linear"),
            eq(schema.integrations.enabled, true),
            sql`${schema.integrations.configJson}->>'organizationId' = ${organizationId}`,
          ),
        )
        .limit(1);

      if (!integration) {
        request.log.warn(
          { organizationId },
          "[linear-webhook] No enabled integration for org",
        );
        await markWebhookStatus(db, payloadHash, "failed");
        return reply.code(200).send({ status: "no_integration" });
      }

      // ── 5. Normalize the event ─────────────────────────────────────────────
      const activity = normalizeLinearEvent(payload, integration.userId);

      if (!activity) {
        request.log.debug(
          { eventType, action: payload["action"] },
          "[linear-webhook] Event not actionable, skipping",
        );
        await markWebhookStatus(db, payloadHash, "processed");
        return reply.code(200).send({ status: "skipped" });
      }

      // ── 6. Persist activity event (idempotent) ─────────────────────────────
      await db
        .insert(schema.activityEvents)
        .values({
          userId: integration.userId,
          integrationId: integration.id,
          provider: "linear",
          eventType: activity.eventType,
          externalId: activity.sourceId,
          title: activity.title,
          url: activity.url ?? null,
          metadata: activity.metadata,
          occurredAt: new Date(activity.occurredAt),
        })
        .onConflictDoNothing();

      // Update last-synced timestamp on the integration
      await db
        .update(schema.integrations)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.integrations.id, integration.id));

      await markWebhookStatus(db, payloadHash, "processed");

      request.log.info(
        {
          eventType: activity.eventType,
          sourceId: activity.sourceId,
          userId: integration.userId,
        },
        "[linear-webhook] Ingested activity",
      );

      return reply.code(200).send({ status: "ok" });
    },
  );
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function markWebhookStatus(
  db: Db,
  payloadHash: string,
  status: "processed" | "failed",
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status, processedAt: new Date() })
    .where(
      and(
        eq(schema.webhookEvents.provider, "linear"),
        eq(schema.webhookEvents.payloadHash, payloadHash),
      ),
    );
}
