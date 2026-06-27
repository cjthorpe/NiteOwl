// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { requireAuth } from '../../plugins/auth.js';
import { runLinearCatchup } from '../../lib/linear-catchup.js';

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const linearCatchupRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  /**
   * POST /api/integrations/linear/catchup
   *
   * Fetches issues completed in the last 24 h from Linear and inserts any
   * missing ones into activity_events. Idempotent — duplicate externalIds are
   * silently ignored via ON CONFLICT DO NOTHING.
   */
  fastify.post(
    '/linear/catchup',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = request.user!.sub;

      // ── Find the user's Linear integration ──────────────────────────────────
      const [integration] = await db
        .select({ id: schema.integrations.id })
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.userId, userId),
            eq(schema.integrations.provider, 'linear'),
            eq(schema.integrations.enabled, true),
          ),
        )
        .limit(1);

      if (!integration) {
        return reply.code(404).send({
          success: false,
          error: 'No enabled Linear integration found',
        });
      }

      // ── Get the stored OAuth token ───────────────────────────────────────────
      const [tokenRow] = await db
        .select({ accessTokenEncrypted: schema.oauthTokens.accessTokenEncrypted })
        .from(schema.oauthTokens)
        .where(
          and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, 'linear')),
        )
        .limit(1);

      if (!tokenRow) {
        return reply.code(404).send({
          success: false,
          error: 'No Linear OAuth token found',
        });
      }

      let result: { ingested: number };
      try {
        result = await runLinearCatchup({
          db,
          userId,
          integrationId: integration.id,
          accessToken: tokenRow.accessTokenEncrypted,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fetch_failed';
        request.log.error({ error: message }, '[linear-catchup] Failed to run catchup');
        return reply.code(502).send({ success: false, error: message });
      }

      return reply.code(200).send({
        success: true,
        data: { ingested: result.ingested },
      });
    },
  );
};
