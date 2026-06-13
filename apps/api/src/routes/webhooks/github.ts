import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { Queue } from "bullmq";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";
import type { NormalizationJobData } from "@niteowl/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the GitHub webhook plugin */
export interface GitHubWebhookOptions {
  db: Db;
  /**
   * BullMQ queue for async normalization.
   * When omitted (e.g. in tests without Redis), events are dropped after
   * idempotency recording — signature + duplicate checks still run.
   */
  queue?: Queue<NormalizationJobData>;
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

  // timingSafeEqual requires equal-length buffers — compare full "sha256=<hex>"
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
  return createHash("sha256").update(body).digest("hex");
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

export const githubWebhookRoutes: FastifyPluginAsync<GitHubWebhookOptions> =
  async (fastify, opts) => {
    const { db, queue } = opts;

    // Parse body as raw Buffer so we can verify the HMAC against the exact
    // bytes GitHub sent — re-serialising the parsed object would differ.
    fastify.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => {
        done(null, body as Buffer);
      },
    );

    fastify.post<{
      Headers: {
        "x-hub-signature-256"?: string;
        "x-github-event"?: string;
        "x-github-delivery"?: string;
      };
      Body: Buffer;
    }>(
      "/",
      // No auth — public webhook endpoint; security is via HMAC signature.
      { config: { rateLimit: { max: 500, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const secret = process.env["GITHUB_WEBHOOK_SECRET"];
        if (!secret) {
          request.log.error("GITHUB_WEBHOOK_SECRET not configured");
          return reply.code(500).send({ error: "Webhook not configured" });
        }

        const rawBody = request.body;

        if (!rawBody || rawBody.length === 0) {
          return reply.code(400).send({ error: "Empty body" });
        }

        // ── 1. Signature verification ────────────────────────────────────
        const signature = request.headers["x-hub-signature-256"];
        if (!verifyGitHubSignature(rawBody, signature, secret)) {
          request.log.warn("GitHub webhook signature mismatch");
          return reply.code(401).send({ error: "Invalid signature" });
        }

        const eventType = request.headers["x-github-event"];
        const deliveryId = request.headers["x-github-delivery"];

        // ── 2. Idempotency guard ─────────────────────────────────────────
        const hash = payloadHash(rawBody);
        const webhookId = await recordWebhookReceived(
          db,
          deliveryId,
          hash,
          eventType,
        );

        if (webhookId === null) {
          // Duplicate delivery — already received
          request.log.info(
            { deliveryId },
            "Duplicate GitHub webhook delivery — skipping",
          );
          return reply.code(200).send({ ok: true, duplicate: true });
        }

        try {
          // ── 3. Parse JSON payload ──────────────────────────────────────
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(rawBody.toString("utf8")) as Record<
              string,
              unknown
            >;
          } catch {
            await markWebhookProcessed(db, webhookId, "failed");
            return reply.code(400).send({ error: "Invalid JSON payload" });
          }

          // ── 4. Resolve user + integration from sender.id ─────────────
          const sender = payload["sender"] as
            | Record<string, unknown>
            | undefined;
          const senderId =
            typeof sender?.["id"] === "number"
              ? (sender["id"] as number)
              : undefined;

          if (senderId === undefined) {
            request.log.warn(
              { deliveryId },
              "GitHub webhook missing sender.id — skipping",
            );
            await markWebhookProcessed(db, webhookId, "processed");
            return reply.code(200).send({ ok: true });
          }

          const resolved = await resolveIntegration(db, senderId);
          if (!resolved) {
            // No matching active integration — not our user
            request.log.debug(
              { senderId },
              "No active GitHub integration for sender — skipping",
            );
            await markWebhookProcessed(db, webhookId, "processed");
            return reply.code(200).send({ ok: true });
          }

          const { userId, integrationId } = resolved;

          // ── 5. Enqueue to BullMQ for async processing ─────────────────
          if (queue) {
            await queue.add("process-github-webhook", {
              provider: "github",
              userId,
              integrationId,
              payload,
            });
          } else {
            // No queue available (e.g. integration test without Redis).
            // Log a warning — the idempotency row is already recorded.
            request.log.warn(
              { userId, webhookId },
              "No normalization queue available — event recorded but not processed",
            );
          }

          await markWebhookProcessed(db, webhookId, "processed");

          request.log.info(
            { userId, eventType, deliveryId },
            "GitHub webhook enqueued",
          );

          return reply.code(200).send({ ok: true });
        } catch (err) {
          await markWebhookProcessed(db, webhookId, "failed");
          request.log.error(
            { err, webhookId },
            "GitHub webhook processing failed",
          );
          return reply.code(500).send({ error: "Processing failed" });
        }
      },
    );
  };
