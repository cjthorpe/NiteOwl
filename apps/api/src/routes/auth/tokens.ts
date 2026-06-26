/**
 * Personal Access Token (PAT) management routes — FUL-91.
 *
 * All routes sit behind `requireAuth`, so any logged-in user — including
 * OAuth-only accounts with no password — can mint a PAT via their cookie
 * session. No password is required.
 *
 *   POST   /auth/tokens       → create; returns the raw token exactly once
 *   GET    /auth/tokens       → list metadata only (never the token)
 *   DELETE /auth/tokens/:id   → revoke (soft, scoped to the owning user)
 *
 * Security: only the SHA-256 fingerprint is stored; every query is scoped by
 * userId; mint/revoke are logged.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { sha256 } from '../../lib/crypto.js';
import { generatePatToken } from '../../lib/pat.js';
import { requireAuth } from '../../plugins/auth.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Upper bound on a token's lifetime — one year. */
const MAX_EXPIRES_IN_DAYS = 365;
/** Upper bound on the human-readable token name. */
const MAX_NAME_LENGTH = 100;

interface CreateTokenBody {
  name: string;
  expiresInDays?: number;
}

export const tokenRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  // ── POST /auth/tokens ──────────────────────────────────────────────────────
  // Mints a new PAT. The raw token is returned ONCE in the response body and
  // never again — only its SHA-256 fingerprint is persisted.
  fastify.post<{ Body: CreateTokenBody }>('/tokens', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: MAX_NAME_LENGTH },
          expiresInDays: { type: 'integer', minimum: 1, maximum: MAX_EXPIRES_IN_DAYS },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user!.sub;
      const { name, expiresInDays } = request.body;

      const rawToken = generatePatToken();
      const expiresAt =
        expiresInDays !== undefined ? new Date(Date.now() + expiresInDays * MS_PER_DAY) : null;

      const [created] = await db
        .insert(schema.personalAccessTokens)
        .values({
          userId,
          name: name.trim(),
          tokenHash: sha256(rawToken),
          expiresAt,
        })
        .returning({
          id: schema.personalAccessTokens.id,
          name: schema.personalAccessTokens.name,
          expiresAt: schema.personalAccessTokens.expiresAt,
          createdAt: schema.personalAccessTokens.createdAt,
        });

      request.log.info({ userId, tokenId: created!.id }, 'Personal access token minted');

      // `token` is present only on this create response — list/get never echo it.
      return reply.code(201).send({
        success: true,
        data: { ...created, token: rawToken },
        error: null,
      });
    },
  });

  // ── GET /auth/tokens ───────────────────────────────────────────────────────
  // Lists metadata for the authed user's tokens. Never returns the raw token
  // or its hash. Revoked tokens are omitted.
  fastify.get('/tokens', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const userId = request.user!.sub;

      const tokens = await db
        .select({
          id: schema.personalAccessTokens.id,
          name: schema.personalAccessTokens.name,
          lastUsedAt: schema.personalAccessTokens.lastUsedAt,
          expiresAt: schema.personalAccessTokens.expiresAt,
          createdAt: schema.personalAccessTokens.createdAt,
        })
        .from(schema.personalAccessTokens)
        .where(
          and(
            eq(schema.personalAccessTokens.userId, userId),
            isNull(schema.personalAccessTokens.revokedAt),
          ),
        )
        .orderBy(desc(schema.personalAccessTokens.createdAt));

      return reply.send({ success: true, data: { tokens }, error: null });
    },
  });

  // ── DELETE /auth/tokens/:id ────────────────────────────────────────────────
  // Soft-revokes a token by setting revoked_at. Scoped to the owning user and
  // to still-active tokens, so neither another user's token nor an already
  // revoked one can be (re-)revoked.
  fastify.delete<{ Params: { id: string } }>('/tokens/:id', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      const [revoked] = await db
        .update(schema.personalAccessTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.personalAccessTokens.id, id),
            eq(schema.personalAccessTokens.userId, userId),
            isNull(schema.personalAccessTokens.revokedAt),
          ),
        )
        .returning({ id: schema.personalAccessTokens.id });

      if (!revoked) {
        return reply.code(404).send({ success: false, error: 'Token not found' });
      }

      request.log.info({ userId, tokenId: revoked.id }, 'Personal access token revoked');

      return reply.send({ success: true, data: null, error: null });
    },
  });
};
