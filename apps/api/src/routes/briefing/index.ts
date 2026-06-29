// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { buildBriefingDigest } from '@niteowl/shared/briefing-digest';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { buildBriefingDigestInput, type BriefingActivityRow } from '../../lib/briefing-input.js';
import { enhanceBriefingWithLlm, resolveBriefingLlmConfig } from '../../lib/briefing-llm.js';
import { requireAuth } from '../../plugins/auth.js';

const DEFAULT_HOURS = 8;
const MAX_HOURS = 72;
/**
 * Safety bound on rows pulled for the digest. The "since last login" window is
 * normally small; this cap keeps an unusually busy window from ballooning memory
 * or the LLM prompt. Counts are derived from these rows, so an extreme overflow
 * would undercount — acceptable for a glanceable summary and far past any real
 * window.
 */
const MAX_ROWS = 1000;

interface BriefingQuery {
  hours?: string;
  /** `since=last_login` resolves the window start to the JWT's lastSeenAt. */
  since?: string;
}

function resolveSince(query: BriefingQuery, lastSeenAt: string | null | undefined): Date {
  if (query.since === 'last_login' && lastSeenAt) {
    return new Date(lastSeenAt);
  }
  const hoursRaw = Number.parseInt(query.hours ?? String(DEFAULT_HOURS), 10);
  const hours =
    Number.isNaN(hoursRaw) || hoursRaw < 1 ? DEFAULT_HOURS : Math.min(hoursRaw, MAX_HOURS);
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * `GET /api/briefing/digest` (FUL-136).
 *
 * Builds the same structured input the web client would, then enhances it with
 * an optional LLM rewrite. Always returns the heuristic shape `{ headline,
 * highlights }`; `source` reports which path produced it so the client and
 * monitoring can tell LLM hits from heuristic fallbacks. The LLM key is a
 * server secret and never leaves this process.
 */
export const briefingRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, opts) => {
  const { db } = opts;
  const llmConfig = resolveBriefingLlmConfig();

  fastify.get<{ Querystring: BriefingQuery }>(
    '/digest',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const since = resolveSince(request.query, request.user!.lastSeenAt);

      const rows = await db
        .select({
          provider: schema.activityEvents.provider,
          eventType: schema.activityEvents.eventType,
          authorLogin: schema.activityEvents.authorLogin,
          // Carried so the digest can recover the actor name from the payload when
          // `author_login` was never populated (repo-scan rows, FUL-139).
          metadata: schema.activityEvents.metadata,
        })
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.userId, userId),
            gte(schema.activityEvents.occurredAt, since),
          ),
        )
        .orderBy(desc(schema.activityEvents.occurredAt), desc(schema.activityEvents.id))
        .limit(MAX_ROWS);

      // `eventType` is stored as text in the DB (typed `string`), but only ever
      // holds known `ActivityEventType` values. The digest builder treats any
      // unrecognised type as a non-counting item, so this boundary cast is safe.
      const input = buildBriefingDigestInput(rows as BriefingActivityRow[]);

      const enhanced = await enhanceBriefingWithLlm(input, {
        config: llmConfig,
        logger: fastify.log,
      });
      const digest = enhanced ?? buildBriefingDigest(input);
      const source = enhanced ? 'llm' : 'heuristic';

      return reply.code(200).send({ ...digest, source });
    },
  );
};
