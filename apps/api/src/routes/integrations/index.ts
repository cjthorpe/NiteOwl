import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";

import { requireAuth } from "../../plugins/auth.js";

export const integrationsRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

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
};
