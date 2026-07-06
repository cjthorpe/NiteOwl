// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { resolveActivityWindow } from '../../lib/activity-window.js';
import { requireAuth } from '../../plugins/auth.js';

import { markAllEventsRead, markEventsRead, unmarkEventsRead } from './read-state.js';

const CACHE_TTL_SECONDS = 60; // 1 minute — per FUL-22 spec
const PAGE_SIZE = 25;
/** Upper bound on how many eventIds a single mark/unmark request may carry. */
const MAX_EVENT_IDS = 500;

interface FeedQuery {
  hours?: string;
  /**
   * Pass `since=last_login` as a shorthand to resolve the start of the feed
   * window to the user's previous session timestamp (from the JWT).  Falls
   * back to DEFAULT_HOURS when the token has no lastSeenAt (first-ever session).
   */
  since?: string;
  provider?: string;
  eventType?: string;
  repo?: string;
  author?: string;
  cursor?: string;
  /** `?unread=true` returns only events the caller has not yet marked read. */
  unread?: string;
}

interface EventIdsBody {
  eventIds?: unknown;
}

interface ReadAllBody {
  before?: unknown;
}

/**
 * Validate a `{ eventIds: string[] }` body: a non-empty array of strings, capped
 * at MAX_EVENT_IDS. Returns the parsed ids, or a string describing the problem.
 */
function parseEventIds(body: EventIdsBody | undefined): string[] | { error: string } {
  const raw = body?.eventIds;
  if (!Array.isArray(raw)) {
    return { error: 'eventIds must be an array of strings' };
  }
  if (raw.length === 0) {
    return { error: 'eventIds must not be empty' };
  }
  if (raw.length > MAX_EVENT_IDS) {
    return { error: `eventIds must contain at most ${MAX_EVENT_IDS} items` };
  }
  if (!raw.every((id): id is string => typeof id === 'string' && id.length > 0)) {
    return { error: 'eventIds must be an array of non-empty strings' };
  }
  return raw;
}

interface CursorPayload {
  occurredAt: string;
  id: string;
}

function encodeCursor(occurredAt: Date, id: string): string {
  const payload: CursorPayload = { occurredAt: occurredAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'occurredAt' in parsed &&
      'id' in parsed &&
      typeof (parsed as CursorPayload).occurredAt === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return parsed as CursorPayload;
    }
  } catch {
    // fall through
  }
  return null;
}

function feedCacheKey(
  userId: string,
  hours: number,
  provider?: string,
  eventType?: string,
  repo?: string,
  author?: string,
  cursor?: string,
  unread?: boolean,
): string {
  const parts = [`feed:${userId}:${hours}`];
  if (provider) parts.push(`p:${provider}`);
  if (eventType) parts.push(`et:${eventType}`);
  if (repo) parts.push(`r:${repo}`);
  if (author) parts.push(`a:${author}`);
  // `unread` changes the row set + total, so it must partition the cache.
  if (unread) parts.push('u:1');
  if (cursor) parts.push(`c:${cursor}`);
  return parts.join(':');
}

/** Store the cache key in a user-level set for targeted invalidation */
async function trackCacheKey(
  redis: import('ioredis').Redis,
  userId: string,
  key: string,
): Promise<void> {
  const setKey = `feed-keys:${userId}`;
  await redis.sadd(setKey, key);
  // Set the tracking set to expire slightly after the longest possible cache TTL
  await redis.expire(setKey, CACHE_TTL_SECONDS + 60);
}

/** Invalidate all cached feed pages for a user — called on new activity ingestion */
export async function invalidateFeedCache(
  redis: import('ioredis').Redis,
  userId: string,
): Promise<void> {
  const setKey = `feed-keys:${userId}`;
  const keys = await redis.smembers(setKey);
  if (keys.length > 0) {
    await redis.del(...keys, setKey);
  }
}

export const feedRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, opts) => {
  const { db } = opts;

  fastify.get<{ Querystring: FeedQuery }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;

      // ── Resolve the feed window start time ────────────────────────────────
      // `?since=last_login` resolves to the user's previous session timestamp
      // (snapshotted in the JWT at login) and windows on ingestion so an
      // overnight catch-up's backfilled events still surface (FUL-142). All
      // other cases use the temporal `?hours` window on occurred_at.
      const { since, hours, byIngestion } = resolveActivityWindow(
        request.query,
        request.user!.lastSeenAt,
      );
      const windowColumn = byIngestion
        ? schema.activityEvents.ingestedAt
        : schema.activityEvents.occurredAt;

      const provider = request.query.provider?.toLowerCase();
      // eventType accepts a single value or a comma-separated list of DB event types.
      const eventTypeRaw = request.query.eventType?.toLowerCase();
      const repo = request.query.repo?.toLowerCase();
      const author = request.query.author?.trim() || undefined;
      const cursorRaw = request.query.cursor;
      const unreadOnly = request.query.unread === 'true';
      // For cache-key purposes, encode `since=last_login` as the resolved ISO
      // timestamp so two users with different lastSeenAt values never share a
      // cache slot.
      const sinceKey =
        request.query.since === 'last_login' ? `sl:${since.toISOString()}` : undefined;

      const cacheKey = feedCacheKey(
        userId,
        hours,
        provider,
        eventTypeRaw,
        repo,
        author,
        sinceKey ?? cursorRaw,
        unreadOnly,
      );

      // ── Cache read ────────────────────────────────────────────────────────
      const redis = fastify.redis;
      if (redis.status === 'ready') {
        const cached = await redis.get(cacheKey);
        if (cached) {
          void reply.header('X-Cache', 'HIT');
          return reply.code(200).send(JSON.parse(cached));
        }
      }

      const conditions: SQL[] = [
        eq(schema.activityEvents.userId, userId),
        gte(windowColumn, since),
      ];

      // Join condition tying each activity event to *this* user's read row (if
      // any). Reused by both the row query and the unread count so the
      // `read` flag and `unreadCount` are always derived from the same rule.
      const readJoinOn = and(
        eq(schema.eventReads.eventId, schema.activityEvents.id),
        eq(schema.eventReads.userId, userId),
      );

      const validProviders = ['github', 'linear', 'jira', 'slack'] as const;
      if (provider && validProviders.includes(provider as (typeof validProviders)[number])) {
        conditions.push(
          eq(schema.activityEvents.provider, provider as (typeof validProviders)[number]),
        );
      }

      const validEventTypes = [
        'pr_opened',
        'pr_merged',
        'pr_closed',
        'commit_pushed',
        'issue_opened',
        'issue_closed',
        'issue_updated',
        'comment_created',
      ] as const;
      // Accept a single value or a comma-separated list (e.g. "pr_opened,pr_merged,pr_closed").
      // Only known event types are allowed through; unknown values are silently dropped.
      if (eventTypeRaw) {
        const requestedTypes = eventTypeRaw
          .split(',')
          .map((t) => t.trim())
          .filter((t): t is (typeof validEventTypes)[number] =>
            validEventTypes.includes(t as (typeof validEventTypes)[number]),
          );
        if (requestedTypes.length === 1) {
          conditions.push(eq(schema.activityEvents.eventType, requestedTypes[0]!));
        } else if (requestedTypes.length > 1) {
          conditions.push(inArray(schema.activityEvents.eventType, requestedTypes));
        }
      }

      if (author) {
        conditions.push(eq(schema.activityEvents.authorLogin, author));
      }

      // cursor: events strictly before (occurredAt, id)
      const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
      if (cursor) {
        const cursorAt = new Date(cursor.occurredAt);
        conditions.push(
          or(
            lt(schema.activityEvents.occurredAt, cursorAt),
            and(
              eq(schema.activityEvents.occurredAt, cursorAt),
              lt(schema.activityEvents.id, cursor.id),
            ),
          )!,
        );
      }

      // `?unread=true` narrows the page to events with no read row for this user.
      if (unreadOnly) {
        conditions.push(isNull(schema.eventReads.id));
      }

      // Each row is annotated with `read` via a LEFT JOIN on the caller's read
      // rows — a matching row means the event has been reviewed.
      const rows = await db
        .select({
          ...getTableColumns(schema.activityEvents),
          read: sql<boolean>`(${schema.eventReads.id} is not null)`,
        })
        .from(schema.activityEvents)
        .leftJoin(schema.eventReads, readJoinOn)
        .where(and(...conditions))
        .orderBy(desc(schema.activityEvents.occurredAt), desc(schema.activityEvents.id))
        .limit(PAGE_SIZE + 1); // fetch one extra to detect next page

      const hasMore = rows.length > PAGE_SIZE;
      const activities = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

      // ── Count (total matching rows for the query window, not just this page) ──
      // A single grouped query yields both the window total and the unread
      // subset (events with no read row for this user), sharing the same LEFT
      // JOIN as the row query. `unread=true` never narrows these — the badge
      // always reflects the full window.
      const [countRow] = await db
        .select({
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) filter (where ${schema.eventReads.id} is null)::int`,
        })
        .from(schema.activityEvents)
        .leftJoin(schema.eventReads, readJoinOn)
        .where(
          and(
            eq(schema.activityEvents.userId, userId),
            gte(windowColumn, since),
            ...(provider && validProviders.includes(provider as (typeof validProviders)[number])
              ? [eq(schema.activityEvents.provider, provider as (typeof validProviders)[number])]
              : []),
            ...(author ? [eq(schema.activityEvents.authorLogin, author)] : []),
          ),
        )
        .limit(1);

      const windowTotal = countRow?.total ?? 0;
      const unreadCount = countRow?.unread ?? 0;

      // Apply repo filter post-query (metadata field) if provided
      const filtered = repo
        ? activities.filter((a) => {
            const meta = a.metadata as Record<string, unknown> | null;
            const repoName =
              typeof meta?.['repo'] === 'string'
                ? meta['repo'].toLowerCase()
                : typeof meta?.['repository'] === 'string'
                  ? meta['repository'].toLowerCase()
                  : null;
            return repoName?.includes(repo) ?? false;
          })
        : activities;

      const lastItem = filtered[filtered.length - 1];
      const nextCursor =
        hasMore && lastItem ? encodeCursor(lastItem.occurredAt, lastItem.id) : null;

      const body = {
        activities: filtered,
        nextCursor,
        // When `unread=true` the page is the unread set, so `total` tracks the
        // unread count to keep pagination totals consistent with the rows.
        total: unreadOnly ? unreadCount : windowTotal,
        unreadCount,
      };

      // ── Cache write ───────────────────────────────────────────────────────
      if (redis.status === 'ready') {
        void redis.set(cacheKey, JSON.stringify(body), 'EX', CACHE_TTL_SECONDS);
        void trackCacheKey(redis, userId, cacheKey);
      }

      void reply.header('X-Cache', 'MISS');
      return reply.code(200).send(body);
    },
  );

  /**
   * Invalidate the caller's cached feed pages after a read-state mutation so the
   * next GET reflects the new `read` flags / `unreadCount` immediately (rather
   * than serving a stale 60s cache entry).
   */
  const invalidate = async (userId: string): Promise<void> => {
    const redis = fastify.redis;
    if (redis.status === 'ready') {
      await invalidateFeedCache(redis, userId);
    }
  };

  // ── POST /read — mark specific events as read ─────────────────────────────
  fastify.post<{ Body: EventIdsBody }>(
    '/read',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const parsed = parseEventIds(request.body);
      if ('error' in parsed) {
        return reply.code(400).send({ error: parsed.error });
      }

      const marked = await markEventsRead(db, userId, parsed);
      await invalidate(userId);
      return reply.code(200).send({ marked });
    },
  );

  // ── POST /read-all — mark every event (optionally up to `before`) as read ──
  fastify.post<{ Body: ReadAllBody }>(
    '/read-all',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;

      let before: Date | undefined;
      const beforeRaw = request.body?.before;
      if (beforeRaw !== undefined && beforeRaw !== null) {
        if (typeof beforeRaw !== 'string') {
          return reply.code(400).send({ error: 'before must be an ISO 8601 timestamp string' });
        }
        const parsedDate = new Date(beforeRaw);
        if (Number.isNaN(parsedDate.getTime())) {
          return reply.code(400).send({ error: 'before must be a valid ISO 8601 timestamp' });
        }
        before = parsedDate;
      }

      const marked = await markAllEventsRead(db, userId, before);
      await invalidate(userId);
      return reply.code(200).send({ marked });
    },
  );

  // ── DELETE /read — mark specific events as unread ─────────────────────────
  fastify.delete<{ Body: EventIdsBody }>(
    '/read',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.sub;
      const parsed = parseEventIds(request.body);
      if ('error' in parsed) {
        return reply.code(400).send({ error: parsed.error });
      }

      const unmarked = await unmarkEventsRead(db, userId, parsed);
      await invalidate(userId);
      return reply.code(200).send({ unmarked });
    },
  );
};
