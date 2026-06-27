// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Integration tests for the Personal Access Token routes (FUL-91) and the
 * auth-plugin PAT branch. Uses Fastify inject + a chainable DB mock, so no real
 * HTTP server or Postgres is needed.
 *
 * Terminal resolvers are separated by query shape so a single request can drive
 * both the PAT lookup (select…limit) and a route handler (insert…returning /
 * select…orderBy / update…returning):
 *   - limitResult     → PAT verification lookup (select…innerJoin…limit)
 *   - returningResult → mint (insert…returning) and revoke (update…returning)
 *   - orderByResult   → list (select…orderBy)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app.js';
import { signAccessToken } from '../../lib/jwt.js';
import { PAT_PREFIX } from '../../lib/pat.js';

let limitResult: unknown[] = [];
let returningResult: unknown[] = [];
let orderByResult: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(() => Promise.resolve(limitResult)),
  orderBy: vi.fn(() => Promise.resolve(orderByResult)),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  returning: vi.fn(() => Promise.resolve(returningResult)),
  catch: vi.fn().mockReturnThis(),
};

const USER_ID = 'user-1';
const EMAIL = 'alice@example.com';

async function authHeader(): Promise<string> {
  const jwt = await signAccessToken(USER_ID, EMAIL, null);
  return `Bearer ${jwt}`;
}

beforeEach(() => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';
  limitResult = [];
  returningResult = [];
  orderByResult = [];
  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.innerJoin.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.limit.mockImplementation(() => Promise.resolve(limitResult));
  mockDb.orderBy.mockImplementation(() => Promise.resolve(orderByResult));
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
  mockDb.returning.mockImplementation(() => Promise.resolve(returningResult));
  mockDb.catch.mockReturnThis();
});

// ── POST /auth/tokens ──────────────────────────────────────────────────────
describe('POST /auth/tokens', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/tokens',
      payload: { name: 'cli' },
    });

    expect(res.statusCode).toBe(401);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('mints a token and returns the raw value exactly once', async () => {
    returningResult = [
      { id: 'pat-1', name: 'cli', expiresAt: null, createdAt: '2026-06-26T00:00:00.000Z' },
    ];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { authorization: await authHeader() },
      payload: { name: 'cli' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ success: boolean; data: { token: string; id: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.token.startsWith(PAT_PREFIX)).toBe(true);
    expect(body.data.id).toBe('pat-1');
    expect(mockDb.insert).toHaveBeenCalledTimes(1);

    // Only the SHA-256 fingerprint is persisted — never the raw token.
    const inserted = mockDb.values.mock.calls[0]![0] as { tokenHash: string };
    expect(inserted.tokenHash).toHaveLength(64);
    expect(inserted.tokenHash).not.toContain(PAT_PREFIX);
  });

  it('computes expires_at from expiresInDays', async () => {
    returningResult = [{ id: 'pat-2', name: 'ci', expiresAt: null, createdAt: 'x' }];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { authorization: await authHeader() },
      payload: { name: 'ci', expiresInDays: 30 },
    });

    expect(res.statusCode).toBe(201);
    const inserted = mockDb.values.mock.calls[0]![0] as { expiresAt: Date | null };
    expect(inserted.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects a missing name with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { authorization: await authHeader() },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range expiresInDays with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { authorization: await authHeader() },
      payload: { name: 'too-long', expiresInDays: 9999 },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── GET /auth/tokens ───────────────────────────────────────────────────────
describe('GET /auth/tokens', () => {
  it('lists metadata only — never the token or its hash', async () => {
    orderByResult = [
      {
        id: 'pat-1',
        name: 'cli',
        lastUsedAt: null,
        expiresAt: null,
        createdAt: '2026-06-26T00:00:00.000Z',
      },
    ];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/auth/tokens',
      headers: { authorization: await authHeader() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { tokens: Record<string, unknown>[] } }>();
    expect(body.data.tokens).toHaveLength(1);
    expect(body.data.tokens[0]).not.toHaveProperty('token');
    expect(body.data.tokens[0]).not.toHaveProperty('tokenHash');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: 'GET', url: '/auth/tokens' });
    expect(res.statusCode).toBe(401);
  });
});

// ── DELETE /auth/tokens/:id ────────────────────────────────────────────────
describe('DELETE /auth/tokens/:id', () => {
  it('revokes a token owned by the user', async () => {
    returningResult = [{ id: 'pat-1' }];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/tokens/pat-1',
      headers: { authorization: await authHeader() },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the token does not exist or is already revoked', async () => {
    returningResult = []; // scoped update matched nothing

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/tokens/missing',
      headers: { authorization: await authHeader() },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── Auth-plugin PAT branch ──────────────────────────────────────────────────
describe('PAT authentication branch', () => {
  it('authenticates a request made with a valid PAT', async () => {
    // verifyPatToken lookup resolves to a live token row…
    limitResult = [{ id: 'pat-1', userId: USER_ID, lastUsedAt: null, email: EMAIL }];
    // …and the GET handler then lists tokens.
    orderByResult = [];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/auth/tokens',
      headers: { authorization: `Bearer ${PAT_PREFIX}validtoken` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects a revoked / expired / unknown PAT with 401', async () => {
    limitResult = []; // lookup filtered out → request.user stays null

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/auth/tokens',
      headers: { authorization: `Bearer ${PAT_PREFIX}revoked` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('does not feed a PAT into the JWT verifier (no fall-through)', async () => {
    limitResult = []; // unknown PAT
    const app = buildApp({ db: mockDb as never });

    const res = await app.inject({
      method: 'GET',
      url: '/auth/tokens',
      headers: { authorization: `Bearer ${PAT_PREFIX}notajwt` },
    });

    // A 401 (not a 500 from JWT parsing) proves the PAT branch handled it.
    expect(res.statusCode).toBe(401);
  });
});
