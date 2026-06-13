import { eq, and } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";

import { requireAuth } from "../../plugins/auth.js";
import { runGitHubCatchup } from "../../lib/github-catchup.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToggleBody {
  enabled: boolean;
}

interface GitHubConnectBody {
  /** GitHub login for the authenticated user (returned from /auth/github callback) */
  login: string;
  /** Decrypted GitHub access token — sent once from the frontend after OAuth */
  accessToken: string;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const integrationsRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  // ── GET /api/integrations — list all integrations for the authed user ──────

  fastify.get(
    "/",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;

      const rows = await db
        .select({
          id: schema.integrations.id,
          provider: schema.integrations.provider,
          enabled: schema.integrations.enabled,
          connectedAt: schema.integrations.connectedAt,
          lastSyncedAt: schema.integrations.lastSyncedAt,
        })
        .from(schema.integrations)
        .where(eq(schema.integrations.userId, userId))
        .orderBy(schema.integrations.connectedAt)
        .limit(100);

      return reply.code(200).send({ integrations: rows });
    },
  );

  // ── PATCH /api/integrations/:id — enable or disable an integration ─────────

  fastify.patch<{
    Params: { id: string };
    Body: ToggleBody;
  }>(
    "/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;
      const body = request.body;

      if (typeof body?.enabled !== "boolean") {
        return reply.code(400).send({ error: "body.enabled must be a boolean" });
      }

      const [updated] = await db
        .update(schema.integrations)
        .set({ enabled: body.enabled })
        .where(
          and(
            eq(schema.integrations.id, id),
            eq(schema.integrations.userId, userId),
          ),
        )
        .returning({
          id: schema.integrations.id,
          enabled: schema.integrations.enabled,
        });

      if (!updated) {
        return reply.code(404).send({ error: "Integration not found" });
      }

      return reply.code(200).send({ integration: updated });
    },
  );

  // ── POST /api/integrations/github/connect — upsert GitHub integration ──────
  // Called by the frontend after OAuth completes to register the integration
  // and trigger a 24-hour catchup of recent activity.

  fastify.post<{ Body: GitHubConnectBody }>(
    "/github/connect",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { login, accessToken } = request.body ?? {};

      if (!login || !accessToken) {
        return reply
          .code(400)
          .send({ error: "login and accessToken are required" });
      }

      // Upsert integration row
      const [integration] = await db
        .insert(schema.integrations)
        .values({
          userId,
          provider: "github",
          enabled: true,
          connectedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: schema.integrations.id });

      // If row already existed, fetch it
      let integrationId: string;
      if (integration) {
        integrationId = integration.id;
      } else {
        const [existing] = await db
          .select({ id: schema.integrations.id })
          .from(schema.integrations)
          .where(
            and(
              eq(schema.integrations.userId, userId),
              eq(schema.integrations.provider, "github"),
            ),
          )
          .limit(1);

        if (!existing) {
          return reply.code(500).send({ error: "Failed to create integration" });
        }
        integrationId = existing.id;

        // Re-enable if it was disabled
        await db
          .update(schema.integrations)
          .set({ enabled: true })
          .where(eq(schema.integrations.id, integrationId));
      }

      // Trigger catchup in the background (don't block the response)
      // We log errors but don't surface them — catchup failure is non-fatal
      runGitHubCatchup({
        db,
        userId,
        integrationId,
        githubLogin: login,
        accessToken,
      })
        .then((result) => {
          fastify.log.info(
            { userId, integrationId, ...result },
            "GitHub catchup complete",
          );
        })
        .catch((err: unknown) => {
          fastify.log.error(
            { err, userId, integrationId },
            "GitHub catchup failed",
          );
        });

      // Update lastSyncedAt optimistically
      await db
        .update(schema.integrations)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.integrations.id, integrationId));

      return reply.code(200).send({ integrationId, status: "connected" });
    },
  );
};
