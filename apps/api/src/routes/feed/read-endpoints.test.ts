// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Integration tests for the per-event read-state endpoints (FUL-140):
 *   - GET  /api/feed          read annotation + unreadCount + ?unread filter
 *   - POST   /api/feed/read       mark specific events
 *   - POST   /api/feed/read-all   mark all (optionally before a cutoff)
 *   - DELETE /api/feed/read       mark specific events unread
 *
 * Uses Fastify inject + mock DB + mock Redis. The mock DB resolves the terminal
 * awaitable of each query shape: `.limit()` for feed reads/counts, `.execute()`
 * for the set-based read-state mutations.
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
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  execute: vi.fn().mockResolvedValue([]),
};

const USER_ID = 'b1234567-0000-0000-0000-000000000001';
let authHeader: string;

beforeEach(async () => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';

  vi.clearAllMocks();

  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.leftJoin.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.orderBy.mockReturnThis();
  mockDb.limit.mockResolvedValue([]);
  mockDb.execute.mockResolvedValue([]);

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

// ── GET /api/feed — read annotation + unreadCount ─────────────────────────────
describe('GET /api/feed read state', () => {
  it('annotates activities with `read` and reports unreadCount', async () => {
    const now = new Date();
    const rows = [
      { id: 'e1', occurredAt: now, metadata: null, read: true },
      { id: 'e2', occurredAt: new Date(now.getTime() - 1000), metadata: null, read: false },
    ];
    mockDb.limit
      .mockResolvedValueOnce(rows) // feed rows (annotated)
      .mockResolvedValueOnce([{ total: 2, unread: 1 }]); // combined count

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      activities: { id: string; read: boolean }[];
      total: number;
      unreadCount: number;
    }>();
    expect(body.activities.map((a) => a.read)).toEqual([true, false]);
    expect(body.total).toBe(2);
    expect(body.unreadCount).toBe(1);
  });

  it('?unread=true reports total equal to unreadCount', async () => {
    const now = new Date();
    mockDb.limit
      .mockResolvedValueOnce([{ id: 'e2', occurredAt: now, metadata: null, read: false }])
      .mockResolvedValueOnce([{ total: 5, unread: 3 }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?unread=true',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ total: number; unreadCount: number }>();
    // With the unread filter, total tracks the unread subset (not the window).
    expect(body.total).toBe(3);
    expect(body.unreadCount).toBe(3);
  });

  it('partitions the cache by unread flag (unread + full feed never collide)', async () => {
    mockDb.limit.mockResolvedValue([]).mockResolvedValue([{ total: 0, unread: 0 }]);
    // reset so each request sees rows then count
    mockDb.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0, unread: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0, unread: 0 }]);

    const app = buildApp({ db: mockDb as never });
    await app.inject({ method: 'GET', url: '/api/feed', headers: { authorization: authHeader } });
    await app.inject({
      method: 'GET',
      url: '/api/feed?unread=true',
      headers: { authorization: authHeader },
    });

    const fullKey = (redisMock.set.mock.calls[0] as string[])[0];
    const unreadKey = (redisMock.set.mock.calls[1] as string[])[0];
    expect(fullKey).not.toBe(unreadKey);
    expect(unreadKey).toContain('u:1');
    expect(fullKey).not.toContain('u:1');
  });
});

// ── POST /api/feed/read ───────────────────────────────────────────────────────
describe('POST /api/feed/read', () => {
  it('returns 401 without auth', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read',
      payload: { eventIds: ['e1'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('marks owned events and returns the marked count', async () => {
    mockDb.execute.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read',
      headers: { authorization: authHeader },
      payload: { eventIds: ['e1', 'e2'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ marked: number }>().marked).toBe(2);
    // Cache invalidated so the next GET reflects the new read state.
    expect(redisMock.smembers).toHaveBeenCalledWith(`feed-keys:${USER_ID}`);
  });

  it('is idempotent — re-marking returns marked: 0', async () => {
    mockDb.execute.mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read',
      headers: { authorization: authHeader },
      payload: { eventIds: ['e1'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ marked: number }>().marked).toBe(0);
  });

  it('rejects a non-array eventIds body with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read',
      headers: { authorization: authHeader },
      payload: { eventIds: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('rejects more than 500 eventIds with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read',
      headers: { authorization: authHeader },
      payload: { eventIds: Array.from({ length: 501 }, (_, i) => `e${i}`) },
    });
    expect(res.statusCode).toBe(400);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

// ── POST /api/feed/read-all ───────────────────────────────────────────────────
describe('POST /api/feed/read-all', () => {
  it('marks all events and returns the count', async () => {
    mockDb.execute.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read-all',
      headers: { authorization: authHeader },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ marked: number }>().marked).toBe(3);
    expect(redisMock.smembers).toHaveBeenCalledWith(`feed-keys:${USER_ID}`);
  });

  it('accepts a valid `before` cutoff', async () => {
    mockDb.execute.mockResolvedValueOnce([{ id: 'r1' }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read-all',
      headers: { authorization: authHeader },
      payload: { before: '2026-01-01T00:00:00.000Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ marked: number }>().marked).toBe(1);
  });

  it('rejects an invalid `before` value with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/feed/read-all',
      headers: { authorization: authHeader },
      payload: { before: 'not-a-date' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/feed/read ─────────────────────────────────────────────────────
describe('DELETE /api/feed/read', () => {
  it('unmarks events and returns the unmarked count', async () => {
    mockDb.execute.mockResolvedValueOnce([{ id: 'r1' }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/feed/read',
      headers: { authorization: authHeader },
      payload: { eventIds: ['e1'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ unmarked: number }>().unmarked).toBe(1);
    expect(redisMock.smembers).toHaveBeenCalledWith(`feed-keys:${USER_ID}`);
  });

  it('a foreign eventId unmarks nothing → 0', async () => {
    mockDb.execute.mockResolvedValueOnce([]); // no row for this user

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/feed/read',
      headers: { authorization: authHeader },
      payload: { eventIds: ['not-mine'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ unmarked: number }>().unmarked).toBe(0);
  });

  it('rejects an empty eventIds array with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/feed/read',
      headers: { authorization: authHeader },
      payload: { eventIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
