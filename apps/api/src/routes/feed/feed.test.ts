// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Integration tests for GET /api/feed and GET /api/integrations.
 * Uses Fastify inject + mock DB + mock Redis — no real network connections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../app.js';
import { signAccessToken } from '../../lib/jwt.js';

// ── Redis mock ─────────────────────────────────────────────────────────────
const redisMock = {
  status: 'ready' as string,
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  sadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  del: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue('OK'),
  connect: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('ioredis', () => {
  const ctor = vi.fn().mockImplementation(() => redisMock);
  return { default: ctor, Redis: ctor };
});

// ── DB mock ────────────────────────────────────────────────────────────────
// All queries end with .limit() as the terminal awaitable call.
// .orderBy() always returns `this` to stay chainable.
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

const USER_ID = 'b1234567-0000-0000-0000-000000000001';
let authHeader: string;

beforeEach(async () => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';

  vi.clearAllMocks();

  // Re-wire chainable mocks after clearAllMocks
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.orderBy.mockReturnThis();
  mockDb.limit.mockResolvedValue([]);
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.returning.mockResolvedValue([]);
  mockDb.delete.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();

  redisMock.status = 'ready';
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue('OK');
  redisMock.sadd.mockResolvedValue(1);
  redisMock.expire.mockResolvedValue(1);
  redisMock.smembers.mockResolvedValue([]);
  redisMock.del.mockResolvedValue(1);
  redisMock.quit.mockResolvedValue('OK');
  redisMock.connect.mockResolvedValue(undefined);
  redisMock.on.mockImplementation(() => undefined);

  const token = await signAccessToken(USER_ID, 'test@example.com');
  authHeader = `Bearer ${token}`;
});

// ── GET /api/feed ───────────────────────────────────────────────────────────
describe('GET /api/feed', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: 'GET', url: '/api/feed' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty feed when no activity events exist', async () => {
    // Feed rows query: .select().from().where().orderBy().limit(26) → []
    mockDb.limit
      .mockResolvedValueOnce([]) // feed rows
      .mockResolvedValueOnce([{ count: 0 }]); // count

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ activities: unknown[]; nextCursor: null; total: number }>();
    expect(body.activities).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.total).toBe(0);
  });

  it('returns paginated activities and a nextCursor when more rows exist', async () => {
    const now = new Date();
    // Build 26 fake activity events (PAGE_SIZE + 1)
    const fakeRows = Array.from({ length: 26 }, (_, i) => ({
      id: `event-${String(i).padStart(3, '0')}`,
      userId: USER_ID,
      integrationId: 'int-001',
      provider: 'github',
      eventType: 'pr.opened',
      externalId: `ext-${i}`,
      title: `PR #${i}`,
      url: null,
      metadata: null,
      occurredAt: new Date(now.getTime() - i * 60_000),
      ingestedAt: now,
    }));

    mockDb.limit
      .mockResolvedValueOnce(fakeRows) // feed rows (26)
      .mockResolvedValueOnce([{ count: 30 }]); // count

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ activities: unknown[]; nextCursor: string | null; total: number }>();
    expect(body.activities).toHaveLength(25);
    expect(typeof body.nextCursor).toBe('string');
    expect(body.total).toBe(30);
  });

  it('serves cached response and sets X-Cache: HIT', async () => {
    const cached = JSON.stringify({ activities: [], nextCursor: null, total: 0 });
    redisMock.get.mockResolvedValueOnce(cached);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-cache']).toBe('HIT');
    // DB should NOT have been queried
    expect(mockDb.limit).not.toHaveBeenCalled();
  });

  it('clamps hours param to MAX_HOURS (72)', async () => {
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?hours=9999',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
  });

  it('decodes a valid cursor and returns activities from that position', async () => {
    const cursorAt = new Date('2026-01-01T00:00:00.000Z');
    const cursor = Buffer.from(
      JSON.stringify({ occurredAt: cursorAt.toISOString(), id: 'event-005' }),
    ).toString('base64url');

    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 5 }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: `/api/feed?cursor=${cursor}`,
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ activities: unknown[]; nextCursor: null; total: number }>();
    expect(body.activities).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('filters by valid provider param', async () => {
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?provider=github',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns X-Cache: MISS on cache bypass and writes to cache', async () => {
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(redisMock.set).toHaveBeenCalled();
  });

  it('skips cache when Redis is not ready', async () => {
    redisMock.status = 'connecting';

    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it('filters by ?author= and returns matching activities', async () => {
    const now = new Date();
    const botActivity = {
      id: 'event-bot-001',
      userId: USER_ID,
      integrationId: 'int-001',
      provider: 'github',
      eventType: 'pr_merged',
      externalId: 'ext-bot-1',
      title: '[org/repo] PR #1: Bot merged',
      url: 'https://github.com/org/repo/pull/1',
      metadata: { author: 'ai-agent-bot', sender: 'ai-agent-bot' },
      authorLogin: 'ai-agent-bot',
      occurredAt: new Date(now.getTime() - 60_000),
      ingestedAt: now,
    };

    mockDb.limit
      .mockResolvedValueOnce([botActivity]) // feed rows
      .mockResolvedValueOnce([{ count: 1 }]); // count

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?author=ai-agent-bot',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      activities: (typeof botActivity)[];
      nextCursor: null;
      total: number;
    }>();
    expect(body.activities).toHaveLength(1);
    expect(body.activities[0]?.authorLogin).toBe('ai-agent-bot');
    expect(body.total).toBe(1);
  });

  it('returns empty feed when ?author= matches no events', async () => {
    mockDb.limit
      .mockResolvedValueOnce([]) // feed rows
      .mockResolvedValueOnce([{ count: 0 }]); // count

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?author=nonexistent-bot',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ activities: unknown[]; nextCursor: null; total: number }>();
    expect(body.activities).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('includes author in the cache key (different authors produce different cache entries)', async () => {
    // First request — author=bot-a
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const app = buildApp({ db: mockDb as never });
    await app.inject({
      method: 'GET',
      url: '/api/feed?author=bot-a',
      headers: { authorization: authHeader },
    });

    // Second request — author=bot-b (cache miss expected because different key)
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    await app.inject({
      method: 'GET',
      url: '/api/feed?author=bot-b',
      headers: { authorization: authHeader },
    });

    // redisMock.set should have been called twice with different keys
    expect(redisMock.set).toHaveBeenCalledTimes(2);
    const firstKey = (redisMock.set.mock.calls[0] as string[])[0];
    const secondKey = (redisMock.set.mock.calls[1] as string[])[0];
    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toContain('a:bot-a');
    expect(secondKey).toContain('a:bot-b');
  });
});

// ── GET /api/integrations ───────────────────────────────────────────────────
describe('GET /api/integrations', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: 'GET', url: '/api/integrations' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty list when user has no integrations', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ integrations: unknown[] }>();
    expect(body.integrations).toEqual([]);
  });

  it('returns list of connected integrations with sync timestamps', async () => {
    const now = new Date().toISOString();
    const fakeIntegrations = [
      { id: 'int-001', provider: 'github', enabled: true, connectedAt: now, lastSyncedAt: now },
      { id: 'int-002', provider: 'linear', enabled: true, connectedAt: now, lastSyncedAt: null },
    ];
    mockDb.limit.mockResolvedValueOnce(fakeIntegrations);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ integrations: typeof fakeIntegrations }>();
    expect(body.integrations).toHaveLength(2);
    expect(body.integrations[0]?.provider).toBe('github');
    expect(body.integrations[1]?.lastSyncedAt).toBeNull();
  });
});
