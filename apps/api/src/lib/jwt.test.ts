// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, it, expect, beforeEach } from 'vitest';

import { signAccessToken, signRefreshToken, verifyToken } from './jwt.js';

beforeEach(() => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
});

describe('signAccessToken / verifyToken', () => {
  it('issues a token that verifies correctly', async () => {
    const token = await signAccessToken('user-123', 'user@example.com');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const payload = await verifyToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('user@example.com');
  });

  it('rejects a token with a wrong secret', async () => {
    const token = await signAccessToken('user-123', 'user@example.com');
    process.env['JWT_SECRET'] = 'completely-different-secret-value-!!';
    await expect(verifyToken(token)).rejects.toThrow();
  });

  it('rejects a token with tampered payload', async () => {
    const token = await signAccessToken('user-123', 'user@example.com');
    const [h, , sig] = token.split('.');
    const fakePayload = Buffer.from(
      JSON.stringify({ sub: 'attacker', email: 'evil@example.com', exp: 9999999999 }),
    ).toString('base64url');
    await expect(verifyToken(`${h}.${fakePayload}.${sig}`)).rejects.toThrow();
  });
});

describe('signRefreshToken', () => {
  it('returns a token and a future expiry date', async () => {
    const { token, expiresAt } = await signRefreshToken('user-456', 'user@example.com');
    expect(typeof token).toBe('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Refresh token should also be a valid JWT verifiable with the same secret
    const payload = await verifyToken(token);
    expect(payload.sub).toBe('user-456');
  });
});
