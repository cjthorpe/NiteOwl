// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { eq, and } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { parseRepoAllowlist } from '../../lib/repo-allowlist.js';
import { requireAuth } from '../../plugins/auth.js';

import { githubCatchupRoutes } from './github-catchup-route.js';
import { linearCatchupRoutes } from './linear-catchup.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UpdateBody {
  enabled?: boolean;
  /** Optional per-integration repo allowlist (FUL-82). [] / omitted = allow all. */
  repoAllowlist?: unknown;
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
        configJson: schema.integrations.configJson,
      })
      .from(schema.integrations)
      .where(eq(schema.integrations.userId, userId))
      .orderBy(schema.integrations.connectedAt)
      .limit(100);

    // Surface the repo allowlist as a clean string[] without leaking the rest
    // of configJson (which may hold internal fields like githubLogin).
    const integrations = rows.map(({ configJson, ...rest }) => ({
      ...rest,
      repoAllowlist: parseRepoAllowlist(configJson as { repoAllowlist?: unknown } | null),
    }));

    return reply.code(200).send({ integrations });
  });

  // ── PATCH /api/integrations/:id — toggle enabled and/or set repo allowlist ──

  fastify.patch<{
    Params: { id: string };
    Body: UpdateBody;
  }>('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;
    const { id } = request.params;
    const body = request.body ?? {};

    const hasEnabled = typeof body.enabled === 'boolean';
    const hasAllowlist = body.repoAllowlist !== undefined;

    if (!hasEnabled && !hasAllowlist) {
      return reply
        .code(400)
        .send({ error: 'body must include `enabled` (boolean) and/or `repoAllowlist` (string[])' });
    }

    // Validate allowlist shape before touching the DB: must be an array of
    // strings if provided. Entries are normalised (trim/lower/dedupe) by
    // parseRepoAllowlist so matching stays consistent across ingestion paths.
    if (hasAllowlist) {
      if (
        !Array.isArray(body.repoAllowlist) ||
        !body.repoAllowlist.every((e) => typeof e === 'string')
      ) {
        return reply.code(400).send({ error: 'body.repoAllowlist must be an array of strings' });
      }
    }

    // Load the current row first so we can merge the allowlist into configJson
    // without clobbering other keys (e.g. githubLogin), and 404 cleanly.
    const [existing] = await db
      .select({ configJson: schema.integrations.configJson })
      .from(schema.integrations)
      .where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId)))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ error: 'Integration not found' });
    }

    const updates: Partial<typeof schema.integrations.$inferInsert> = {};
    if (hasEnabled) updates.enabled = body.enabled;

    let nextAllowlist: string[] | null = null;
    if (hasAllowlist) {
      nextAllowlist = parseRepoAllowlist({ repoAllowlist: body.repoAllowlist });
      const currentConfig = (existing.configJson as Record<string, unknown> | null) ?? {};
      updates.configJson = { ...currentConfig, repoAllowlist: nextAllowlist };
    }

    const [updated] = await db
      .update(schema.integrations)
      .set(updates)
      .where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId)))
      .returning({
        id: schema.integrations.id,
        enabled: schema.integrations.enabled,
        configJson: schema.integrations.configJson,
      });

    if (!updated) {
      return reply.code(404).send({ error: 'Integration not found' });
    }

    return reply.code(200).send({
      integration: {
        id: updated.id,
        enabled: updated.enabled,
        repoAllowlist: parseRepoAllowlist(updated.configJson as { repoAllowlist?: unknown } | null),
      },
    });
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
  void fastify.register(linearCatchupRoutes, { db });

  // ── GitHub-specific routes (catchup) ─────────────────────────────────────
  void fastify.register(githubCatchupRoutes, { db });
};
