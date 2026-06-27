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
