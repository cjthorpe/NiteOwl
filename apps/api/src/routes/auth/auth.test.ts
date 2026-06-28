// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Integration tests for auth routes — use Fastify inject so no real HTTP
 * server or Postgres connection is needed.  DB calls are intercepted via
 * vi.mock so every code-path in the route handlers is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildApp } from '../../app.js';

// ── DB mock ────────────────────────────────────────────────────────────────
// Each test controls what the mock DB returns by reassigning these vars.
let selectRows: unknown[] = [];
let insertedRows: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => Promise.resolve(selectRows)),
  insert: vi.fn().mockReturnThis(),
  // values must return `this` so .returning() can be chained on inserts
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockImplementation(() => Promise.resolve(insertedRows)),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  // set must return `this` so .where() can be chained on updates
  set: vi.fn().mockReturnThis(),
};

beforeEach(() => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';
  selectRows = [];
  insertedRows = [];
  vi.clearAllMocks();
  // Re-wire chainable mocks after clearAllMocks
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.limit.mockImplementation(() => Promise.resolve(selectRows));
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.returning.mockImplementation(() => Promise.resolve(insertedRows));
  mockDb.delete.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
});

// ── Tests: POST /auth/register ─────────────────────────────────────────────
describe('POST /auth/register', () => {
  it('creates a user and returns an access token', async () => {
    selectRows = []; // no existing user
    insertedRows = [{ id: 'user-001', email: 'alice@example.com' }];
    // Second insert (refresh token) also needs to resolve
    mockDb.returning
      .mockImplementationOnce(() => Promise.resolve(insertedRows))
      .mockImplementationOnce(() => Promise.resolve([]));

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'alice@example.com', password: 'hunter2hunter2' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ success: boolean; data: { accessToken: string } }>();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.accessToken.split('.')).toHaveLength(3);
  });

  it('returns 409 when the email is already registered', async () => {
    selectRows = [{ id: 'existing-user' }];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'taken@example.com', password: 'hunter2hunter2' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/already registered/i);
  });

  it('returns 400 for invalid email format', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'hunter2hunter2' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── Tests: POST /auth/login ────────────────────────────────────────────────
describe('POST /auth/login', () => {
  it('returns 401 for unknown email', async () => {
    selectRows = [];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ghost@example.com', password: 'irrelevant' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    // Pre-hash a known password so we can test mismatch
    const { hashPassword } = await import('../../lib/password.js');
    const hash = await hashPassword('correct-password');
    selectRows = [{ id: 'u1', email: 'bob@example.com', passwordHash: hash }];
    mockDb.limit.mockImplementation(() => Promise.resolve(selectRows));

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'bob@example.com', password: 'wrong-password' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Tests: POST /auth/logout ───────────────────────────────────────────────
describe('POST /auth/logout', () => {
  it('clears the refresh cookie and returns success', async () => {
    mockDb.delete.mockReturnThis();
    mockDb.where.mockImplementation(() => Promise.resolve());

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { niteowl_refresh: 'some-fake-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean }>();
    expect(body.success).toBe(true);

    // Cookie should be cleared
    const setCookieHeader = res.headers['set-cookie'] as string | string[];
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join('; ')
      : (setCookieHeader ?? '');
    expect(cookieStr).toMatch(/niteowl_refresh/);
  });
});

// ── Tests: POST /auth/refresh ──────────────────────────────────────────────
describe('POST /auth/refresh', () => {
  it('returns 401 with no cookie', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an unknown/never-issued refresh token', async () => {
    selectRows = []; // no matching token in DB

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { niteowl_refresh: 'stale-token' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/invalid or expired/i);
  });
});

// ── Tests: POST /auth/refresh (happy path + rotation) ─────────────────────
describe('POST /auth/refresh — token rotation', () => {
  it('issues a new access token and rotates the refresh cookie on success', async () => {
    const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 1st limit() call: find the stored token (active, not yet rotated).
    // 2nd limit() call: look up the user.
    mockDb.limit
      .mockImplementationOnce(() =>
        Promise.resolve([
          {
            id: 'rt-001',
            userId: 'user-001',
            rotatedAt: null,
            expiresAt: futureExpiry,
          },
        ]),
      )
      .mockImplementationOnce(() =>
        Promise.resolve([{ id: 'user-001', email: 'alice@example.com' }]),
      );

    // update().set().where() chain resolves via mockReturnThis → set returns Promise
    // insert().values() also resolves via the values mock

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { niteowl_refresh: 'valid-refresh-jwt' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { accessToken: string } }>();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.accessToken.split('.')).toHaveLength(3);

    // A new refresh cookie must be set (token rotation)
    const setCookieHeader = res.headers['set-cookie'] as string | string[];
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join('; ')
      : (setCookieHeader ?? '');
    expect(cookieStr).toMatch(/niteowl_refresh/);

    // The update (soft-mark rotatedAt) must have been called
    expect(mockDb.update).toHaveBeenCalled();
    // A fresh token must have been inserted
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns 401 for an expired token that was not yet rotated', async () => {
    const pastExpiry = new Date(Date.now() - 1000);

    mockDb.limit.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: 'rt-expired',
          userId: 'user-001',
          rotatedAt: null,
          expiresAt: pastExpiry,
        },
      ]),
    );

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { niteowl_refresh: 'expired-token' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/invalid or expired/i);
    // Must NOT have tried to issue a new token
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ── Tests: POST /auth/refresh — replay detection ───────────────────────────
describe('POST /auth/refresh — replay detection (nuclear option)', () => {
  it('revokes all user sessions when a previously-rotated token is replayed', async () => {
    const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // The token exists in DB but has already been rotated (stolen scenario).
    mockDb.limit.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: 'rt-already-used',
          userId: 'user-stolen',
          rotatedAt: new Date(Date.now() - 60_000), // rotated 1 min ago
          expiresAt: futureExpiry,
        },
      ]),
    );

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { niteowl_refresh: 'stolen-old-token' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/already used.*sessions revoked/i);

    // The nuclear delete must have been triggered
    expect(mockDb.delete).toHaveBeenCalled();

    // No new token should have been issued
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('clears the refresh cookie after replay detection', async () => {
    const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    mockDb.limit.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: 'rt-already-used',
          userId: 'user-stolen',
          rotatedAt: new Date(),
          expiresAt: futureExpiry,
        },
      ]),
    );

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { niteowl_refresh: 'stolen-old-token' },
    });

    expect(res.statusCode).toBe(401);

    // Cookie must be cleared so the attacker's browser loses the session
    const setCookieHeader = res.headers['set-cookie'] as string | string[];
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join('; ')
      : (setCookieHeader ?? '');
    expect(cookieStr).toMatch(/niteowl_refresh/);
  });
});

// ── Tests: CSRF Origin/Referer hardening on cookie-auth routes (FUL-134) ────
// The `niteowl_refresh` cookie's SameSite=Strict is the primary CSRF control;
// `originCheck` is layered defense-in-depth. These lock the behaviour in.
describe('CSRF origin check on /auth/* mutations', () => {
  const ALLOWED = 'https://app.niteowl.test';

  beforeEach(() => {
    // Pin the allowlist deterministically regardless of ambient env.
    process.env['CORS_ORIGIN'] = ALLOWED;
    delete process.env['WEB_URL'];
  });

  it('rejects POST /auth/refresh from a forbidden Origin with 403', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { origin: 'https://evil.example' },
      cookies: { niteowl_refresh: 'whatever' },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/origin not allowed/i);
    // The handler must not have run — no DB lookup happened.
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('rejects POST /auth/logout from a forbidden Origin without deleting tokens', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: 'https://evil.example' },
      cookies: { niteowl_refresh: 'victim-token' },
    });

    expect(res.statusCode).toBe(403);
    // Forged logout must not revoke the victim's session.
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('rejects POST /auth/login from a forbidden Origin (login-CSRF) with 403', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'victim@example.com', password: 'irrelevant' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects POST /auth/register from a forbidden Origin with 403', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'victim@example.com', password: 'hunter2hunter2' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows an allowlisted Origin through the check (login proceeds to 401)', async () => {
    selectRows = []; // unknown user → handler returns 401, proving check passed
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: ALLOWED },
      payload: { email: 'ghost@example.com', password: 'irrelevant' },
    });

    // Not 403: the Origin was accepted and the route handler ran.
    expect(res.statusCode).toBe(401);
  });

  it('allows a request with no Origin/Referer (non-browser client policy)', async () => {
    selectRows = [];
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ghost@example.com', password: 'irrelevant' },
    });

    // Header-less request is allowed by policy; handler runs → 401 for unknown user.
    expect(res.statusCode).toBe(401);
  });

  it('falls back to Referer when Origin is absent — forbidden Referer is rejected', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { referer: 'https://evil.example/login' },
      cookies: { niteowl_refresh: 'whatever' },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ── Invariant: /api/* mutations are Bearer-only and reject cookie-only auth ──
// This locks the core assumption of the FUL-119 threat model: `/api/*` never
// authenticates from a cookie, so it is CSRF-immune by construction. If a
// future change wired cookie auth into the API surface, this test breaks.
describe('Invariant: /api/* mutations do not accept cookie auth', () => {
  it('POST /api/agent-logins returns 401 when only a refresh cookie is sent (no Bearer)', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-logins',
      // A valid-looking session cookie but NO Authorization header.
      cookies: { niteowl_refresh: 'a-real-looking-session-cookie' },
      payload: { integration: 'github', login: 'some-bot' },
    });

    expect(res.statusCode).toBe(401);
    // The cookie must not have authenticated the request into the handler.
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
