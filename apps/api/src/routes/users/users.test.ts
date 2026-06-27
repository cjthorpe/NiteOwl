// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Unit tests for GET /api/users/me and the ?since=last_login feed integration.
 * Covers: FUL-63 acceptance criteria.
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

beforeEach(async () => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';

  vi.clearAllMocks();

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
});

// ── GET /api/users/me ───────────────────────────────────────────────────────
describe('GET /api/users/me', () => {
  it('returns 401 when no Authorization header', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: 'GET', url: '/api/users/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns user profile with lastSeenAt=null for a first-ever session token', async () => {
    // Token signed without a lastSeenAt (null) — simulates first login
    const token = await signAccessToken(USER_ID, 'user@example.com', null);
    const authHeader = `Bearer ${token}`;

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      data: { id: string; email: string; lastSeenAt: string | null };
      error: null;
    }>();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(USER_ID);
    expect(body.data.email).toBe('user@example.com');
    expect(body.data.lastSeenAt).toBeNull();
    expect(body.error).toBeNull();
  });

  it('returns lastSeenAt ISO string when token carries a previous session timestamp', async () => {
    const prevSessionStart = new Date('2026-06-12T08:00:00.000Z');
    const token = await signAccessToken(USER_ID, 'user@example.com', prevSessionStart);
    const authHeader = `Bearer ${token}`;

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      data: { id: string; email: string; lastSeenAt: string | null };
      error: null;
    }>();
    expect(body.data.lastSeenAt).toBe('2026-06-12T08:00:00.000Z');
  });

  it('returns lastSeenAt=null for tokens that pre-date FUL-63 (no lastSeenAt claim)', async () => {
    // Simulate an older token that didn't include lastSeenAt — verifyToken normalises to null
    const token = await signAccessToken(USER_ID, 'user@example.com');
    const authHeader = `Bearer ${token}`;

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { lastSeenAt: string | null } }>();
    // Tokens issued without lastSeenAt get null — backwards compat
    expect(body.data.lastSeenAt).toBeNull();
  });
});

// ── GET /api/feed?since=last_login ─────────────────────────────────────────
describe('GET /api/feed?since=last_login', () => {
  it('resolves since=last_login to the JWT lastSeenAt and returns matching events', async () => {
    const prevSessionStart = new Date('2026-06-12T08:00:00.000Z');
    const token = await signAccessToken(USER_ID, 'user@example.com', prevSessionStart);
    const authHeader = `Bearer ${token}`;

    mockDb.limit
      .mockResolvedValueOnce([]) // feed rows
      .mockResolvedValueOnce([{ count: 0 }]); // count

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?since=last_login',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ activities: unknown[]; nextCursor: null; total: number }>();
    expect(body.activities).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('falls back to DEFAULT_HOURS when lastSeenAt is null (first-ever session)', async () => {
    const token = await signAccessToken(USER_ID, 'user@example.com', null);
    const authHeader = `Bearer ${token}`;

    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?since=last_login',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
  });

  it('since=last_login produces a different cache key than the default hours window', async () => {
    const prevSessionStart = new Date('2026-06-12T08:00:00.000Z');
    const token = await signAccessToken(USER_ID, 'user@example.com', prevSessionStart);
    const authHeader = `Bearer ${token}`;

    // First request: since=last_login
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);
    const app = buildApp({ db: mockDb as never });
    await app.inject({
      method: 'GET',
      url: '/api/feed?since=last_login',
      headers: { authorization: authHeader },
    });

    // Second request: no since param (uses default hours)
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);
    await app.inject({
      method: 'GET',
      url: '/api/feed',
      headers: { authorization: authHeader },
    });

    expect(redisMock.set).toHaveBeenCalledTimes(2);
    const firstKey = (redisMock.set.mock.calls[0] as string[])[0];
    const secondKey = (redisMock.set.mock.calls[1] as string[])[0];
    expect(firstKey).not.toBe(secondKey);
    // The last_login cache key contains the resolved ISO timestamp
    expect(firstKey).toContain('sl:');
  });

  it('lastSeenAt snapshot in JWT is stable across requests (same cache key — no collapse)', async () => {
    const prevSessionStart = new Date('2026-06-11T22:00:00.000Z');
    const token = await signAccessToken(USER_ID, 'user@example.com', prevSessionStart);
    const authHeader = `Bearer ${token}`;

    // First request — cache miss, DB queried
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const app = buildApp({ db: mockDb as never });
    await app.inject({
      method: 'GET',
      url: '/api/feed?since=last_login',
      headers: { authorization: authHeader },
    });

    // Capture the cache key written on the first request
    const firstKey = (redisMock.set.mock.calls[0] as string[])[0];
    expect(firstKey).toContain('sl:');
    expect(firstKey).toContain('2026-06-11T22:00:00.000Z');

    // Simulate the second request hitting the cache (same resolved ISO key)
    const cachedBody = JSON.stringify({ activities: [], nextCursor: null, total: 0 });
    redisMock.get.mockResolvedValueOnce(cachedBody);

    const res2 = await app.inject({
      method: 'GET',
      url: '/api/feed?since=last_login',
      headers: { authorization: authHeader },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['x-cache']).toBe('HIT');

    // DB was NOT queried a second time — cache was hit
    // redisMock.set called only once (from the first miss)
    expect(redisMock.set).toHaveBeenCalledTimes(1);
  });
});
