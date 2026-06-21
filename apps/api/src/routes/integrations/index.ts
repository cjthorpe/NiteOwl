import { eq, and } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { requireAuth } from '../../plugins/auth.js';
import { githubCatchupRoutes } from './github-catchup-route.js';
import { linearCatchupRoutes } from './linear-catchup.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToggleBody {
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const integrationsRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, opts) => {
  const { db } = opts;

  // ── GET /api/integrations — list all integrations for the authed user ──────

  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
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
  });

  // ── PATCH /api/integrations/:id — enable or disable an integration ─────────

  fastify.patch<{
    Params: { id: string };
    Body: ToggleBody;
  }>('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;
    const { id } = request.params;
    const body = request.body;

    if (typeof body?.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'body.enabled must be a boolean' });
    }

    const [updated] = await db
      .update(schema.integrations)
      .set({ enabled: body.enabled })
      .where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId)))
      .returning({
        id: schema.integrations.id,
        enabled: schema.integrations.enabled,
      });

    if (!updated) {
      return reply.code(404).send({ error: 'Integration not found' });
    }

    return reply.code(200).send({ integration: updated });
  });

  // ── DELETE /api/integrations/providers/:provider — disconnect an integration ─
  // Clears the integration record and its OAuth token from the database,
  // satisfying the acceptance criterion: "Disconnecting an integration clears
  // its tokens from the database."

  fastify.delete<{ Params: { provider: string } }>(
    '/providers/:provider',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { provider } = request.params;

      const validProviders = ['github', 'linear', 'jira', 'slack'] as const;
      type ValidProvider = (typeof validProviders)[number];
      if (!validProviders.includes(provider as ValidProvider)) {
        return reply.code(400).send({ error: 'Unknown provider' });
      }

      const typedProvider = provider as ValidProvider;

      // Delete integration record (activity_events cascade-deletes via FK)
      await db
        .delete(schema.integrations)
        .where(
          and(
            eq(schema.integrations.userId, userId),
            eq(schema.integrations.provider, typedProvider),
          ),
        );

      // Delete OAuth token (never leave credentials in DB after disconnect)
      await db
        .delete(schema.oauthTokens)
        .where(
          and(
            eq(schema.oauthTokens.userId, userId),
            eq(schema.oauthTokens.provider, typedProvider),
          ),
        );

      return reply.code(200).send({ success: true });
    },
  );

  // ── Linear-specific routes (catchup) ─────────────────────────────────────
  // Pass only `{ db }`, never the parent `opts`: `opts` still carries the
  // parent's `prefix` ('/api/integrations'), and Fastify applies a `prefix`
  // option additively. Re-passing it would mount these routes at
  // '/api/integrations/api/integrations/...' and 404 the documented paths (FUL-75).
  fastify.register(linearCatchupRoutes, { db });

  // ── GitHub-specific routes (catchup) ─────────────────────────────────────
  fastify.register(githubCatchupRoutes, { db });
};
