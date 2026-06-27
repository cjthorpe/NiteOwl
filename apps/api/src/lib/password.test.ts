// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, it, expect } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

describe('hashPassword', () => {
  it('returns a bcrypt hash (does not store plaintext)', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt format with 12 rounds
    expect(hash).not.toContain('correct-horse');
  });

  it('produces different hashes for the same input (salt randomness)', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  it('returns true for the correct password', async () => {
    const hash = await hashPassword('my-secret-password');
    expect(await verifyPassword('my-secret-password', hash)).toBe(true);
  });

  it('returns false for the wrong password', async () => {
    const hash = await hashPassword('my-secret-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
