import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { requireAuth } from '../../plugins/auth.js';

const CACHE_TTL_SECONDS = 60; // 1 minute — per FUL-22 spec
const DEFAULT_HOURS = 8;
const MAX_HOURS = 72;
const PAGE_SIZE = 25;

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
): string {
  const parts = [`feed:${userId}:${hours}`];
  if (provider) parts.push(`p:${provider}`);
  if (eventType) parts.push(`et:${eventType}`);
  if (repo) parts.push(`r:${repo}`);
  if (author) parts.push(`a:${author}`);
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
      // (snapshotted in the JWT at login). All other cases use `?hours`.
      let since: Date;
      let hours: number;
      if (request.query.since === 'last_login') {
        const jwtLastSeenAt = request.user!.lastSeenAt;
        if (jwtLastSeenAt) {
          since = new Date(jwtLastSeenAt);
          hours = Math.ceil((Date.now() - since.getTime()) / (60 * 60 * 1000));
        } else {
          // First-ever session — fall back to the default window
          hours = DEFAULT_HOURS;
          since = new Date(Date.now() - hours * 60 * 60 * 1000);
        }
      } else {
        const hoursRaw = parseInt(request.query.hours ?? String(DEFAULT_HOURS), 10);
        hours =
          Number.isNaN(hoursRaw) || hoursRaw < 1 ? DEFAULT_HOURS : Math.min(hoursRaw, MAX_HOURS);
        since = new Date(Date.now() - hours * 60 * 60 * 1000);
      }

      const provider = request.query.provider?.toLowerCase();
      // eventType accepts a single value or a comma-separated list of DB event types.
      const eventTypeRaw = request.query.eventType?.toLowerCase();
      const repo = request.query.repo?.toLowerCase();
      const author = request.query.author?.trim() || undefined;
      const cursorRaw = request.query.cursor;
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

      const conditions: ReturnType<typeof eq>[] = [
        eq(schema.activityEvents.userId, userId),
        gte(schema.activityEvents.occurredAt, since),
      ];

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

      const rows = await db
        .select()
        .from(schema.activityEvents)
        .where(and(...conditions))
        .orderBy(desc(schema.activityEvents.occurredAt), desc(schema.activityEvents.id))
        .limit(PAGE_SIZE + 1); // fetch one extra to detect next page

      const hasMore = rows.length > PAGE_SIZE;
      const activities = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

      // ── Count (total matching rows for this query window, not just this page) ──
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.userId, userId),
            gte(schema.activityEvents.occurredAt, since),
            ...(provider && validProviders.includes(provider as (typeof validProviders)[number])
              ? [eq(schema.activityEvents.provider, provider as (typeof validProviders)[number])]
              : []),
            ...(author ? [eq(schema.activityEvents.authorLogin, author)] : []),
          ),
        )
        .limit(1);

      // Apply repo filter post-query (metadata field) if provided
      const filtered = repo
        ? activities.filter((a) => {
            const meta = a.metadata as Record<string, unknown> | null;
            const repoName =
              typeof meta?.['repo'] === 'string'
                ? meta['repo'].toLowerCase()
                : typeof meta?.['repository'] === 'string'
                  ? (meta['repository'] as string).toLowerCase()
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
        total: countRow?.count ?? 0,
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
};
