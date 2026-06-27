// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decryptToken,
  encryptToken,
  parseEncryptedToken,
  serializeEncryptedToken,
  timingSafeCompare,
} from './crypto';

// A valid 32-byte key expressed as 64 hex chars.
const TEST_KEY = 'a'.repeat(64);

describe('encryptToken / decryptToken', () => {
  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env['ENCRYPTION_KEY'];
  });

  it('round-trips a plaintext token', () => {
    const plaintext = 'gho_super_secret_access_token';
    const { ciphertext, iv } = encryptToken(plaintext);
    expect(decryptToken({ ciphertext, iv })).toBe(plaintext);
  });

  it('produces a different ciphertext on each call (unique IV)', () => {
    const plaintext = 'same_token';
    const first = encryptToken(plaintext);
    const second = encryptToken(plaintext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('returns hex-encoded strings for ciphertext and iv', () => {
    const { ciphertext, iv } = encryptToken('test');
    expect(ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(iv).toMatch(/^[0-9a-f]+$/);
  });

  it('iv is 24 hex chars (12 bytes)', () => {
    const { iv } = encryptToken('test');
    expect(iv).toHaveLength(24);
  });

  it('throws when ENCRYPTION_KEY is missing', () => {
    delete process.env['ENCRYPTION_KEY'];
    expect(() => encryptToken('x')).toThrow('ENCRYPTION_KEY environment variable is not set');
  });

  it('throws when ENCRYPTION_KEY is wrong length', () => {
    process.env['ENCRYPTION_KEY'] = 'tooshort';
    expect(() => encryptToken('x')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
  });

  it('throws when ENCRYPTION_KEY contains non-hex characters', () => {
    process.env['ENCRYPTION_KEY'] = 'g'.repeat(64); // 'g' is not valid hex
    expect(() => encryptToken('x')).toThrow('ENCRYPTION_KEY must contain only hex characters');
  });

  it('throws on tampered ciphertext (GCM auth tag fails)', () => {
    const { ciphertext, iv } = encryptToken('secret');
    // Flip a byte in the ciphertext portion (not the tag).
    const tampered = '00' + ciphertext.slice(2);
    expect(() => decryptToken({ ciphertext: tampered, iv })).toThrow();
  });

  it('throws on tampered iv', () => {
    const { ciphertext, iv } = encryptToken('secret');
    const tamperedIv = 'ff' + iv.slice(2);
    expect(() => decryptToken({ ciphertext, iv: tamperedIv })).toThrow();
  });

  it('throws when ciphertext is too short to contain auth tag', () => {
    expect(() => decryptToken({ ciphertext: 'aabb', iv: 'a'.repeat(24) })).toThrow(
      'Ciphertext too short',
    );
  });

  it('round-trips an empty string', () => {
    expect(decryptToken(encryptToken(''))).toBe('');
  });

  it('round-trips a long token', () => {
    const long = 'x'.repeat(2048);
    expect(decryptToken(encryptToken(long))).toBe(long);
  });

  it('round-trips unicode characters', () => {
    const unicode = '日本語テスト 🔑';
    expect(decryptToken(encryptToken(unicode))).toBe(unicode);
  });
});

describe('serializeEncryptedToken / parseEncryptedToken', () => {
  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env['ENCRYPTION_KEY'];
  });

  it('serialises and round-trips via parse', () => {
    const token = encryptToken('access_token_value');
    const serialized = serializeEncryptedToken(token);
    const parsed = parseEncryptedToken(serialized);
    expect(parsed).toEqual(token);
  });

  it('serialised format starts with v1:', () => {
    const serialized = serializeEncryptedToken({ iv: 'aabbcc', ciphertext: 'ddeeff' });
    expect(serialized).toBe('v1:aabbcc:ddeeff');
  });

  it('full round-trip: encrypt → serialize → parse → decrypt', () => {
    const plaintext = 'ghp_real_token_here';
    const encrypted = encryptToken(plaintext);
    const col = serializeEncryptedToken(encrypted);
    const recovered = decryptToken(parseEncryptedToken(col));
    expect(recovered).toBe(plaintext);
  });

  it('throws on unrecognised format', () => {
    expect(() => parseEncryptedToken('v2:iv:ct')).toThrow('Unrecognised encrypted token format');
  });

  it('throws when parts are missing', () => {
    expect(() => parseEncryptedToken('v1:onlyonecolon')).toThrow(
      'Unrecognised encrypted token format',
    );
  });
});

describe('timingSafeCompare', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeCompare('secret', 'secret')).toBe(true);
  });

  it('returns false for differing strings of same length', () => {
    expect(timingSafeCompare('aaaaaa', 'aaaaab')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeCompare('short', 'much-longer-string')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeCompare('', '')).toBe(true);
  });

  it('handles unicode correctly', () => {
    expect(timingSafeCompare('🔑secret', '🔑secret')).toBe(true);
    expect(timingSafeCompare('🔑secret', '🗝secret')).toBe(false);
  });
});
