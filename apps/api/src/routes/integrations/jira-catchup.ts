// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';


import { runJiraCatchup } from '../../lib/jira-catchup.js';
import { requireAuth } from '../../plugins/auth.js';

interface JiraConfig {
  cloudId?: unknown;
  siteUrl?: unknown;
}

export const jiraCatchupRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  /**
   * POST /api/integrations/jira/catchup
   *
   * Fetches issues updated in the last 24 h from Jira and inserts any missing
   * ones into activity_events. Idempotent — duplicate externalIds are silently
   * ignored via ON CONFLICT DO NOTHING (and match the webhook path's ids).
   */
  fastify.post(
    '/jira/catchup',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = request.user!.sub;

      // ── Find the user's Jira integration (needs cloudId + siteUrl) ───────────
      const [integration] = await db
        .select({
          id: schema.integrations.id,
          configJson: schema.integrations.configJson,
        })
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.userId, userId),
            eq(schema.integrations.provider, 'jira'),
            eq(schema.integrations.enabled, true),
          ),
        )
        .limit(1);

      if (!integration) {
        return reply.code(404).send({
          success: false,
          error: 'No enabled Jira integration found',
        });
      }

      const config = (integration.configJson as JiraConfig | null) ?? {};
      const cloudId = typeof config.cloudId === 'string' ? config.cloudId : null;
      const siteUrl = typeof config.siteUrl === 'string' ? config.siteUrl : null;

      if (!cloudId || !siteUrl) {
        return reply.code(409).send({
          success: false,
          error: 'Jira integration missing cloudId/siteUrl — reconnect required',
        });
      }

      // ── Get the stored OAuth token (encrypted fields + expiry) ───────────────
      const [tokenRow] = await db
        .select({
          accessTokenEncrypted: schema.oauthTokens.accessTokenEncrypted,
          refreshTokenEncrypted: schema.oauthTokens.refreshTokenEncrypted,
          expiresAt: schema.oauthTokens.expiresAt,
        })
        .from(schema.oauthTokens)
        .where(and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, 'jira')))
        .limit(1);

      if (!tokenRow) {
        return reply.code(404).send({
          success: false,
          error: 'No Jira OAuth token found',
        });
      }

      let result: { ingested: number };
      try {
        result = await runJiraCatchup({
          db,
          userId,
          integrationId: integration.id,
          cloudId,
          siteUrl,
          accessTokenEncrypted: tokenRow.accessTokenEncrypted,
          refreshTokenEncrypted: tokenRow.refreshTokenEncrypted,
          expiresAt: tokenRow.expiresAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fetch_failed';
        request.log.error({ error: message }, '[jira-catchup] Failed to run catchup');
        return reply.code(502).send({ success: false, error: message });
      }

      return reply.code(200).send({
        success: true,
        data: { ingested: result.ingested },
      });
    },
  );
};
