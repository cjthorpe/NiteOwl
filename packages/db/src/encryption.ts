// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * AES-256-GCM application-layer encryption for sensitive fields.
 *
 * Every token, webhook URL, and config blob stored in the DB passes through
 * these helpers before write and after read. The raw secret never touches the
 * database layer.
 *
 * Wire format (base64url-separated by "."): <iv>.<ciphertext>.<authTag>
 *
 * Environment:
 *   DB_ENCRYPTION_KEY — 32-byte hex string (64 hex chars) or 32-byte base64.
 *   Generate with: openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16; // 128-bit auth tag

function loadKey(): Buffer {
  const raw = process.env['DB_ENCRYPTION_KEY'];
  if (!raw) {
    throw new Error('DB_ENCRYPTION_KEY is not set. ' + 'Generate with: openssl rand -hex 32');
  }
  // Accept 64-char hex or 44-char base64 (both encode 32 bytes).
  const buf = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`DB_ENCRYPTION_KEY must decode to 32 bytes; got ${buf.length} bytes`);
  }
  return buf;
}

/**
 * Encrypt a plaintext string.
 * Returns a dot-separated base64url string: <iv>.<ciphertext>.<authTag>
 */
export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a ciphertext produced by {@link encrypt}.
 * Throws if the auth tag does not verify (tampering detected).
 */
export function decrypt(ciphertext: string): string {
  const key = loadKey();
  const parts = ciphertext.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format (expected iv.ct.tag)');
  }
  const [ivB64, ctB64, tagB64] = parts as [string, string, string];

  const iv = Buffer.from(ivB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: ${iv.length}`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid auth tag length: ${tag.length}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Encrypt a value only if it is not null/undefined.
 * Useful for optional fields like refresh_token.
 */
export function encryptOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  return encrypt(value);
}

/**
 * Decrypt a value only if it is not null.
 */
export function decryptOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decrypt(value);
}

/**
 * True if `value` has the wire shape produced by {@link encrypt} —
 * three "."-separated base64url segments whose iv/tag decode to the expected
 * byte lengths (`<iv>.<ciphertext>.<authTag>`).
 *
 * Used to distinguish real ciphertext from legacy plaintext during the
 * FUL-135 plaintext→ciphertext migration of OAuth tokens. Raw OAuth tokens
 * (GitHub `gho_…`, Linear `lin_oauth_…`) never contain "." so they are
 * unambiguously classified as plaintext.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [ivB64, , tagB64] = parts as [string, string, string];
  try {
    return (
      Buffer.from(ivB64, 'base64url').length === IV_BYTES &&
      Buffer.from(tagB64, 'base64url').length === TAG_BYTES
    );
  } catch {
    return false;
  }
}

/**
 * Decrypt a token value, tolerating legacy plaintext rows.
 *
 * OAuth tokens were historically persisted in plaintext despite the
 * `*_encrypted` column names (FUL-135). During and after the backfill
 * migration, read paths may still encounter un-encrypted values; this helper
 * returns those untouched so live integrations keep working, while genuinely
 * encrypted values are decrypted and integrity-checked. A value that *looks*
 * encrypted but fails its GCM auth tag still throws — tampering is never
 * silently ignored.
 */
export function decryptToken(value: string): string {
  return isEncrypted(value) ? decrypt(value) : value;
}

/**
 * Nullable variant of {@link decryptToken} for optional columns
 * (e.g. `refresh_token_encrypted`).
 */
export function decryptTokenOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decryptToken(value);
}
