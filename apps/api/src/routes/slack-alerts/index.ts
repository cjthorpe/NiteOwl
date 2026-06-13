/**
 * Slack Alert Config routes (FUL-26)
 *
 * Manages per-user Slack Incoming Webhook configurations that fire digest
 * alerts when a PR is merged to a watched branch.
 *
 * Endpoints:
 *   GET    /api/slack-alerts          — list all configs for the authed user
 *   POST   /api/slack-alerts          — create a new config
 *   PATCH  /api/slack-alerts/:id      — update watchedRepos / enabled / webhookUrl
 *   DELETE /api/slack-alerts/:id      — remove a config
 */

import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { Db } from "@niteowl/db";
import { encrypt, decrypt, schema } from "@niteowl/db";

import { requireAuth } from "../../plugins/auth.js";

// ---------------------------------------------------------------------------
// Request body types
// ---------------------------------------------------------------------------

interface CreateBody {
  /** Plain-text Slack Incoming Webhook URL — encrypted before storage */
  webhookUrl: string;
  /** Repo full-names to watch, e.g. ["owner/repo"] */
  watchedRepos?: string[];
}

interface UpdateBody {
  webhookUrl?: string;
  watchedRepos?: string[];
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_URL_PATTERN = /^https:\/\/hooks\.slack\.com\//;

function validateWebhookUrl(url: unknown): url is string {
  return typeof url === "string" && WEBHOOK_URL_PATTERN.test(url);
}

function validateWatchedRepos(repos: unknown): repos is string[] {
  if (!Array.isArray(repos)) return false;
  return repos.every(
    (r) => typeof r === "string" && r.includes("/") && r.length <= 200,
  );
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const slackAlertRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  // ── GET /api/slack-alerts ─────────────────────────────────────────────────

  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;

    const rows = await db
      .select({
        id: schema.slackAlertConfigs.id,
        watchedRepos: schema.slackAlertConfigs.watchedRepos,
        enabled: schema.slackAlertConfigs.enabled,
        createdAt: schema.slackAlertConfigs.createdAt,
        updatedAt: schema.slackAlertConfigs.updatedAt,
      })
      .from(schema.slackAlertConfigs)
      .where(eq(schema.slackAlertConfigs.userId, userId))
      .orderBy(schema.slackAlertConfigs.createdAt)
      .limit(20); // a user is unlikely to need more than 20 Slack configs

    return reply.code(200).send({ configs: rows });
  });

  // ── POST /api/slack-alerts ────────────────────────────────────────────────

  fastify.post<{ Body: CreateBody }>(
    "/",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const body = request.body;

      if (!validateWebhookUrl(body?.webhookUrl)) {
        return reply.code(400).send({
          error:
            "webhookUrl must be a valid Slack Incoming Webhook URL (https://hooks.slack.com/…)",
        });
      }

      const watchedRepos = body.watchedRepos ?? [];
      if (!validateWatchedRepos(watchedRepos)) {
        return reply.code(400).send({
          error: 'watchedRepos must be an array of "owner/repo" strings',
        });
      }

      const webhookUrlEncrypted = encrypt(body.webhookUrl);

      const [created] = await db
        .insert(schema.slackAlertConfigs)
        .values({
          userId,
          webhookUrlEncrypted,
          watchedRepos,
          enabled: true,
        })
        .returning({
          id: schema.slackAlertConfigs.id,
          watchedRepos: schema.slackAlertConfigs.watchedRepos,
          enabled: schema.slackAlertConfigs.enabled,
          createdAt: schema.slackAlertConfigs.createdAt,
          updatedAt: schema.slackAlertConfigs.updatedAt,
        });

      return reply.code(201).send({ config: created });
    },
  );

  // ── PATCH /api/slack-alerts/:id ───────────────────────────────────────────

  fastify.patch<{ Params: { id: string }; Body: UpdateBody }>(
    "/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;
      const body = request.body ?? {};

      const updates: Partial<{
        webhookUrlEncrypted: string;
        watchedRepos: string[];
        enabled: boolean;
        updatedAt: Date;
      }> = { updatedAt: new Date() };

      if (body.webhookUrl !== undefined) {
        if (!validateWebhookUrl(body.webhookUrl)) {
          return reply.code(400).send({
            error:
              "webhookUrl must be a valid Slack Incoming Webhook URL (https://hooks.slack.com/…)",
          });
        }
        updates.webhookUrlEncrypted = encrypt(body.webhookUrl);
      }

      if (body.watchedRepos !== undefined) {
        if (!validateWatchedRepos(body.watchedRepos)) {
          return reply.code(400).send({
            error: 'watchedRepos must be an array of "owner/repo" strings',
          });
        }
        updates.watchedRepos = body.watchedRepos;
      }

      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") {
          return reply
            .code(400)
            .send({ error: "enabled must be a boolean" });
        }
        updates.enabled = body.enabled;
      }

      const [updated] = await db
        .update(schema.slackAlertConfigs)
        .set(updates)
        .where(
          and(
            eq(schema.slackAlertConfigs.id, id),
            eq(schema.slackAlertConfigs.userId, userId),
          ),
        )
        .returning({
          id: schema.slackAlertConfigs.id,
          watchedRepos: schema.slackAlertConfigs.watchedRepos,
          enabled: schema.slackAlertConfigs.enabled,
          createdAt: schema.slackAlertConfigs.createdAt,
          updatedAt: schema.slackAlertConfigs.updatedAt,
        });

      if (!updated) {
        return reply.code(404).send({ error: "Slack alert config not found" });
      }

      return reply.code(200).send({ config: updated });
    },
  );

  // ── DELETE /api/slack-alerts/:id ──────────────────────────────────────────

  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      const [deleted] = await db
        .delete(schema.slackAlertConfigs)
        .where(
          and(
            eq(schema.slackAlertConfigs.id, id),
            eq(schema.slackAlertConfigs.userId, userId),
          ),
        )
        .returning({ id: schema.slackAlertConfigs.id });

      if (!deleted) {
        return reply.code(404).send({ error: "Slack alert config not found" });
      }

      return reply.code(204).send();
    },
  );
};

// ---------------------------------------------------------------------------
// Helper re-export for use in the normalization worker
// ---------------------------------------------------------------------------

/**
 * Retrieves all enabled Slack alert configs for a user and decrypts webhook URLs.
 * Used by the normalization worker to fire alerts after a PR merge.
 */
export async function getEnabledAlertsForUser(
  db: Db,
  userId: string,
): Promise<Array<{ id: string; webhookUrl: string; watchedRepos: string[] }>> {
  const rows = await db
    .select({
      id: schema.slackAlertConfigs.id,
      webhookUrlEncrypted: schema.slackAlertConfigs.webhookUrlEncrypted,
      watchedRepos: schema.slackAlertConfigs.watchedRepos,
    })
    .from(schema.slackAlertConfigs)
    .where(
      and(
        eq(schema.slackAlertConfigs.userId, userId),
        eq(schema.slackAlertConfigs.enabled, true),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    webhookUrl: decrypt(r.webhookUrlEncrypted),
    watchedRepos: r.watchedRepos,
  }));
}
