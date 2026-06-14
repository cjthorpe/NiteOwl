/**
 * Agent Login registration routes (FUL-59)
 *
 * Per-user registry of AI agent identities per integration.
 * Registered logins auto-populate feed filters and Slack alert botUserLogins.
 *
 * Endpoints:
 *   GET    /api/agent-logins            — list all registered logins for authed user
 *   POST   /api/agent-logins            — register a new agent login
 *   DELETE /api/agent-logins/:id        — remove a registered agent login
 */

import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { requireAuth } from '../../plugins/auth.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VALID_INTEGRATIONS = ['github', 'linear', 'jira'] as const;
type AgentIntegration = (typeof VALID_INTEGRATIONS)[number];

interface CreateBody {
  integration: AgentIntegration;
  login: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidIntegration(value: unknown): value is AgentIntegration {
  return VALID_INTEGRATIONS.includes(value as AgentIntegration);
}

function isValidLogin(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const agentLoginRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, opts) => {
  const { db } = opts;

  // ── GET /api/agent-logins ─────────────────────────────────────────────────
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;

    const rows = await db
      .select({
        id: schema.userAgentLogins.id,
        integration: schema.userAgentLogins.integration,
        login: schema.userAgentLogins.login,
        createdAt: schema.userAgentLogins.createdAt,
      })
      .from(schema.userAgentLogins)
      .where(eq(schema.userAgentLogins.userId, userId))
      .orderBy(schema.userAgentLogins.integration, schema.userAgentLogins.login);

    return reply.code(200).send({ logins: rows });
  });

  // ── POST /api/agent-logins ────────────────────────────────────────────────
  fastify.post<{ Body: CreateBody }>('/', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;
    const body = request.body;

    if (!isValidIntegration(body?.integration)) {
      return reply.code(400).send({
        error: `integration must be one of: ${VALID_INTEGRATIONS.join(', ')}`,
      });
    }

    if (!isValidLogin(body?.login)) {
      return reply.code(400).send({
        error: 'login must be a non-empty string (max 200 characters)',
      });
    }

    const login = body.login.trim();

    // Upsert — if the triple already exists, return 200 with the existing row.
    const existing = await db
      .select({ id: schema.userAgentLogins.id })
      .from(schema.userAgentLogins)
      .where(
        and(
          eq(schema.userAgentLogins.userId, userId),
          eq(schema.userAgentLogins.integration, body.integration),
          eq(schema.userAgentLogins.login, login),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const [row] = await db
        .select()
        .from(schema.userAgentLogins)
        .where(eq(schema.userAgentLogins.id, existing[0]!.id))
        .limit(1);
      return reply.code(200).send({ login: row });
    }

    const [created] = await db
      .insert(schema.userAgentLogins)
      .values({ userId, integration: body.integration, login })
      .returning({
        id: schema.userAgentLogins.id,
        integration: schema.userAgentLogins.integration,
        login: schema.userAgentLogins.login,
        createdAt: schema.userAgentLogins.createdAt,
      });

    return reply.code(201).send({ login: created });
  });

  // ── DELETE /api/agent-logins/:id ──────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      const [deleted] = await db
        .delete(schema.userAgentLogins)
        .where(and(eq(schema.userAgentLogins.id, id), eq(schema.userAgentLogins.userId, userId)))
        .returning({ id: schema.userAgentLogins.id });

      if (!deleted) {
        return reply.code(404).send({ error: 'Agent login not found' });
      }

      return reply.code(204).send();
    },
  );
};

// ---------------------------------------------------------------------------
// Helper for other modules (e.g. Slack alert pre-fill)
// ---------------------------------------------------------------------------

/**
 * Returns all registered GitHub agent logins for a user.
 * Used to pre-fill Slack alert botUserLogins defaults.
 */
export async function getAgentLoginsForUser(
  db: Db,
  userId: string,
  integration: AgentIntegration = 'github',
): Promise<string[]> {
  const rows = await db
    .select({ login: schema.userAgentLogins.login })
    .from(schema.userAgentLogins)
    .where(
      and(
        eq(schema.userAgentLogins.userId, userId),
        eq(schema.userAgentLogins.integration, integration),
      ),
    );
  return rows.map((r) => r.login);
}
