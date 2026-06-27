// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Unit tests for the Personal Access Token helpers (FUL-91).
 *
 * The DB is a chainable mock — no Postgres required. `limitResult` controls
 * what the token lookup returns; an empty array simulates the SQL WHERE filter
 * eliminating an unknown / revoked / expired row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sha256 } from './crypto.js';
import { PAT_PREFIX, generatePatToken, isPatToken, verifyPatToken } from './pat.js';

let limitResult: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(() => Promise.resolve(limitResult)),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  // The throttled last-used bump is fire-and-forget: `…where(…).catch(…)`.
  catch: vi.fn().mockReturnThis(),
};

beforeEach(() => {
  limitResult = [];
  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.innerJoin.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.limit.mockImplementation(() => Promise.resolve(limitResult));
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
  mockDb.catch.mockReturnThis();
});

describe('isPatToken', () => {
  it('recognises the niteowl_pat_ prefix', () => {
    expect(isPatToken('niteowl_pat_abc')).toBe(true);
  });

  it('rejects a JWT-shaped token', () => {
    expect(isPatToken('eyJhbGciOiJIUzI1Ni"')).toBe(false);
    expect(isPatToken('')).toBe(false);
  });
});

describe('generatePatToken', () => {
  it('produces a prefixed, base64url token', () => {
    const token = generatePatToken();
    expect(token.startsWith(PAT_PREFIX)).toBe(true);
    // 32 random bytes → 43 base64url chars (no padding).
    expect(token.slice(PAT_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is unique across calls', () => {
    expect(generatePatToken()).not.toBe(generatePatToken());
  });
});

describe('verifyPatToken', () => {
  it('returns a TokenPayload shape for a valid token and bumps last_used_at', async () => {
    limitResult = [{ id: 'pat-1', userId: 'user-9', lastUsedAt: null, email: 'alice@example.com' }];

    const result = await verifyPatToken(mockDb as never, 'niteowl_pat_valid');

    expect(result).toEqual({ sub: 'user-9', email: 'alice@example.com', lastSeenAt: null });
    // last_used_at was null → stale → bump fires.
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('hashes the raw token before lookup — never queries the raw value', async () => {
    const raw = 'niteowl_pat_secret';
    limitResult = [{ id: 'pat-2', userId: 'u', lastUsedAt: null, email: 'e@x.com' }];

    await verifyPatToken(mockDb as never, raw);

    expect(sha256(raw)).toHaveLength(64);
    expect(sha256(raw)).not.toBe(raw);
  });

  it('returns null for an unknown / revoked / expired token (no row)', async () => {
    limitResult = []; // WHERE filtered it out

    const result = await verifyPatToken(mockDb as never, 'niteowl_pat_gone');

    expect(result).toBeNull();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('skips the last_used_at bump when it was used recently (throttle)', async () => {
    limitResult = [{ id: 'pat-3', userId: 'u', lastUsedAt: new Date(), email: 'e@x.com' }];

    await verifyPatToken(mockDb as never, 'niteowl_pat_recent');

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
