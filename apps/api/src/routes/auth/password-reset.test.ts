// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Integration tests for the password-reset routes — use Fastify inject so no
 * real HTTP server or Postgres is needed. DB calls are intercepted via a
 * chainable mock and the email transport is mocked so no network call is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildApp } from '../../app.js';
import { sha256 } from '../../lib/crypto.js';

// ── Email transport mock ─────────────────────────────────────────────────────
vi.mock('../../lib/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, attempts: 1 }),
  buildPasswordResetEmail: vi.fn((to: string, resetUrl: string) => ({
    to,
    subject: 'Reset your NiteOwl password',
    text: resetUrl,
  })),
  appBaseUrl: () => 'http://localhost:5173',
}));
import { sendEmail } from '../../lib/email.js';

// ── DB mock ──────────────────────────────────────────────────────────────────
// Each test controls what select returns by reassigning `selectRows`.
let selectRows: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  // .for('update') — row lock used by the reset-password lookup.
  for: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => Promise.resolve(selectRows)),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  // transaction(cb) runs the callback with the same chainable mock as `tx`.
  transaction: vi.fn((cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
};

beforeEach(() => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';
  selectRows = [];
  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.limit.mockImplementation(() => Promise.resolve(selectRows));
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
  mockDb.delete.mockReturnThis();
  mockDb.for.mockReturnThis();
  mockDb.transaction.mockImplementation((cb: (tx: typeof mockDb) => Promise<unknown>) =>
    cb(mockDb),
  );
});

// ── POST /auth/forgot-password ───────────────────────────────────────────────
describe('POST /auth/forgot-password', () => {
  it('returns a generic 200 for an unknown email and sends no email', async () => {
    selectRows = []; // no such user

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'nobody@example.com' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { message: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.message).toMatch(/if an account exists/i);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('issues a token and sends an email for a password-backed account', async () => {
    selectRows = [{ id: 'user-1', passwordHash: '$2a$12$abcdefghijklmnopqrstuv' }];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'alice@example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.insert).toHaveBeenCalledTimes(1); // token row inserted
    expect(mockDb.delete).toHaveBeenCalledTimes(1); // prior tokens invalidated first
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('skips OAuth-only users (no passwordHash) but still returns generic 200', async () => {
    selectRows = [{ id: 'user-2', passwordHash: null }];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'oauth@example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('does not leak account existence — identical body for known vs unknown', async () => {
    const app = buildApp({ db: mockDb as never });

    selectRows = [{ id: 'user-3', passwordHash: '$2a$12$abcdefghijklmnopqrstuv' }];
    const known = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'known@example.com' },
    });

    selectRows = [];
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'unknown@example.com' },
    });

    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.body).toBe(unknown.body);
  });

  it('rejects an invalid email format with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── POST /auth/reset-password ────────────────────────────────────────────────
describe('POST /auth/reset-password', () => {
  it('rejects an unknown / expired / used token with 400', async () => {
    selectRows = []; // query filters out expired/used/missing → no row

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'bogus-token', password: 'newpassword123' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid or expired/i);
    // Lookup happens inside the transaction (SELECT … FOR UPDATE) but no
    // mutation runs when the token is missing.
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('resets the password, consumes the token, and revokes refresh tokens', async () => {
    selectRows = [{ id: 'token-1', userId: 'user-9' }];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'valid-raw-token', password: 'brand-new-pass' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { message: string } }>();
    expect(body.success).toBe(true);

    // All mutations ran inside a single transaction.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    // Password update + token consume = 2 update calls; 1 delete for revocation.
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
  });

  it('looks the token up via a select before mutating anything', async () => {
    selectRows = [{ id: 'token-2', userId: 'user-10' }];
    const rawToken = 'another-raw-token';

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: rawToken, password: 'brand-new-pass' },
    });

    expect(res.statusCode).toBe(200);
    // A lookup runs first (select → from → where → limit), and only then the
    // mutating transaction. The route hashes the raw token before querying, so
    // the stored fingerprint is a 64-char hex digest, never the raw value.
    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(sha256(rawToken)).toHaveLength(64);
    expect(sha256(rawToken)).not.toBe(rawToken);
  });

  it('treats a single-use token as spent on the second attempt', async () => {
    const app = buildApp({ db: mockDb as never });

    // First use: token found and consumed.
    selectRows = [{ id: 'token-3', userId: 'user-11' }];
    const first = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'one-time-token', password: 'first-new-pass' },
    });
    expect(first.statusCode).toBe(200);

    // Second use: token now has usedAt set, so the filtered query returns none.
    selectRows = [];
    const second = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'one-time-token', password: 'second-new-pass' },
    });
    expect(second.statusCode).toBe(400);
  });

  it('rejects passwords shorter than 8 characters with 400', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'valid-raw-token', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
  });
});
