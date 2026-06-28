// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { maybeEncrypt } from './backfill-oauth-encryption.js';
import { decrypt, isEncrypted } from './encryption.js';

const TEST_KEY = 'b'.repeat(64);
// Synthetic token: realistic dotless shape, but underscores break the GitHub
// secret-scanner pattern so it is never mistaken for a real credential.
const RAW_TOKEN = 'gho_fake_test_value_not_a_secret';

describe('backfill-oauth-encryption: maybeEncrypt', () => {
  beforeEach(() => {
    process.env['DB_ENCRYPTION_KEY'] = TEST_KEY;
  });
  afterEach(() => {
    delete process.env['DB_ENCRYPTION_KEY'];
  });

  it('encrypts legacy plaintext, preserving the recoverable value', () => {
    const result = maybeEncrypt(RAW_TOKEN);
    expect(result.changed).toBe(true);
    expect(result.next).not.toBeNull();
    expect(isEncrypted(result.next!)).toBe(true);
    expect(decrypt(result.next!)).toBe(RAW_TOKEN);
  });

  it('is idempotent: an already-encrypted value is left unchanged', () => {
    const once = maybeEncrypt(RAW_TOKEN);
    const twice = maybeEncrypt(once.next!);
    expect(twice.changed).toBe(false);
    expect(twice.next).toBe(once.next);
  });

  it('leaves null and empty values untouched (optional refresh tokens)', () => {
    expect(maybeEncrypt(null)).toEqual({ next: null, changed: false });
    expect(maybeEncrypt('')).toEqual({ next: '', changed: false });
  });
});
