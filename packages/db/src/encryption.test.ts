// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decrypt,
  decryptOptional,
  decryptToken,
  decryptTokenOptional,
  encrypt,
  encryptOptional,
  isEncrypted,
} from './encryption.js';

// 32-byte key (64 hex chars) — deterministic for tests only.
const TEST_KEY = 'a'.repeat(64);

// Synthetic raw OAuth tokens. They keep the realistic dotless shape (so the
// plaintext-vs-ciphertext classification is exercised) while deliberately
// breaking the GitHub/Linear secret-scanner patterns (underscores after the
// prefix) so the fixtures are never mistaken for real credentials.
const GH_TOKEN = 'gho_fake_test_value_not_a_secret';
const LINEAR_TOKEN = 'lin_oauth_fake_test_value_not_real';

describe('@niteowl/db encryption', () => {
  beforeEach(() => {
    process.env['DB_ENCRYPTION_KEY'] = TEST_KEY;
  });
  afterEach(() => {
    delete process.env['DB_ENCRYPTION_KEY'];
  });

  describe('encrypt / decrypt round-trip', () => {
    it('round-trips an OAuth access token', () => {
      expect(decrypt(encrypt(GH_TOKEN))).toBe(GH_TOKEN);
    });

    it('produces a fresh IV each call (no deterministic ciphertext leak)', () => {
      expect(encrypt(GH_TOKEN)).not.toBe(encrypt(GH_TOKEN));
    });

    it('never leaks the plaintext token inside the ciphertext', () => {
      expect(encrypt(GH_TOKEN)).not.toContain(GH_TOKEN);
    });

    it('round-trips optional values and preserves null', () => {
      expect(decryptOptional(encryptOptional(LINEAR_TOKEN))).toBe(LINEAR_TOKEN);
      expect(encryptOptional(null)).toBeNull();
      expect(decryptOptional(null)).toBeNull();
    });
  });

  describe('isEncrypted', () => {
    it('recognises ciphertext produced by encrypt()', () => {
      expect(isEncrypted(encrypt(GH_TOKEN))).toBe(true);
    });

    it('classifies raw OAuth tokens as plaintext', () => {
      expect(isEncrypted(GH_TOKEN)).toBe(false);
      expect(isEncrypted(LINEAR_TOKEN)).toBe(false);
    });

    it('classifies the legacy seed format (enc:v1:…) as plaintext', () => {
      expect(isEncrypted('enc:v1:c29tZS10b2tlbg==')).toBe(false);
    });

    it('rejects dot-shaped values whose segments are the wrong byte length', () => {
      expect(isEncrypted('a.b.c')).toBe(false);
    });
  });

  describe('decryptToken (legacy-tolerant read path)', () => {
    it('decrypts genuinely encrypted values', () => {
      expect(decryptToken(encrypt(GH_TOKEN))).toBe(GH_TOKEN);
    });

    it('passes legacy plaintext through untouched', () => {
      expect(decryptToken(GH_TOKEN)).toBe(GH_TOKEN);
      expect(decryptToken(LINEAR_TOKEN)).toBe(LINEAR_TOKEN);
    });

    it('still throws on a tampered ciphertext (integrity is enforced)', () => {
      const ct = encrypt(GH_TOKEN);
      const parts = ct.split('.');
      // Flip a character in the ciphertext segment so the GCM auth tag fails.
      const flipped = parts[1]!.startsWith('A') ? 'B' : 'A';
      const tampered = [parts[0], flipped + parts[1]!.slice(1), parts[2]].join('.');
      expect(() => decryptToken(tampered)).toThrow();
    });

    it('handles the nullable variant', () => {
      expect(decryptTokenOptional(encrypt(LINEAR_TOKEN))).toBe(LINEAR_TOKEN);
      expect(decryptTokenOptional(null)).toBeNull();
      expect(decryptTokenOptional(undefined)).toBeNull();
    });
  });
});
