// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { buildBriefingDigest } from '@niteowl/shared/briefing-digest';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { resolveActivityWindow, type ActivityWindowQuery } from '../../lib/activity-window.js';
import { buildBriefingDigestInput, type BriefingActivityRow } from '../../lib/briefing-input.js';
import { enhanceBriefingWithLlm, resolveBriefingLlmConfig } from '../../lib/briefing-llm.js';
import { requireAuth } from '../../plugins/auth.js';

/**
 * Safety bound on rows pulled for the digest. The "since last login" window is
 * normally small; this cap keeps an unusually busy window from ballooning memory
 * or the LLM prompt. Counts are derived from these rows, so an extreme overflow
 * would undercount — acceptable for a glanceable summary and far past any real
 * window.
 */
const MAX_ROWS = 1000;

type BriefingQuery = ActivityWindowQuery;

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
      const { since, byIngestion } = resolveActivityWindow(request.query, request.user!.lastSeenAt);
      // `since=last_login` windows on ingestion so an overnight catch-up's
      // backfilled events (whose provider timestamps predate the login) still
      // surface in the briefing (FUL-142). The `hours` window stays on
      // occurred_at to match the dashboard's temporal view.
      const windowColumn = byIngestion
        ? schema.activityEvents.ingestedAt
        : schema.activityEvents.occurredAt;

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
        .where(and(eq(schema.activityEvents.userId, userId), gte(windowColumn, since)))
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
