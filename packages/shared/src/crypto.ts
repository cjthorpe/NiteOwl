/**
 * Token encryption utilities using AES-256-GCM (Node built-in crypto).
 *
 * Encryption key is loaded from the ENCRYPTION_KEY environment variable,
 * which must be a 64-character hex string representing 32 bytes.
 *
 * The IV (12 bytes / 96 bits) is randomly generated per encryption and must
 * be stored alongside the ciphertext. It is not secret but must never be
 * reused with the same key.
 *
 * GCM produces a 16-byte authentication tag that is appended to the
 * ciphertext buffer so decryption can verify integrity.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export interface EncryptedToken {
  /** Hex-encoded ciphertext with appended GCM auth tag (last 32 hex chars). */
  ciphertext: string;
  /** Hex-encoded 12-byte IV. */
  iv: string;
}

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16; // 128-bit auth tag (GCM default)
const KEY_HEX_LENGTH = 64; // 32 bytes × 2 hex chars each

function loadKey(): Buffer {
  const raw = process.env['ENCRYPTION_KEY'];
  if (!raw) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  if (raw.length !== KEY_HEX_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be a ${KEY_HEX_LENGTH}-character hex string (32 bytes); got ${raw.length} chars`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error('ENCRYPTION_KEY must contain only hex characters (0-9, a-f, A-F)');
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The value to encrypt (e.g. a raw OAuth access token).
 * @returns `{ ciphertext, iv }` — both as hex strings. The caller is
 *   responsible for persisting both alongside each other. A convenience
 *   helper (`serializeEncryptedToken` / `parseEncryptedToken`) is provided
 *   for single-column DB storage.
 */
export function encryptToken(plaintext: string): EncryptedToken {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Append tag to ciphertext so decryptToken receives everything it needs.
  const ciphertextWithTag = Buffer.concat([encrypted, tag]);

  return {
    ciphertext: ciphertextWithTag.toString('hex'),
    iv: iv.toString('hex'),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted token produced by `encryptToken`.
 *
 * @param token - `{ ciphertext, iv }` pair returned from `encryptToken`.
 * @returns The original plaintext string.
 * @throws If the key is missing/invalid or if the GCM auth tag fails
 *   verification (tampered or corrupted data).
 */
export function decryptToken({ ciphertext, iv }: EncryptedToken): string {
  const key = loadKey();
  const buf = Buffer.from(ciphertext, 'hex');

  if (buf.length < TAG_BYTES) {
    throw new Error('Ciphertext too short: missing GCM auth tag');
  }

  const tag = buf.subarray(buf.length - TAG_BYTES);
  const encrypted = buf.subarray(0, buf.length - TAG_BYTES);
  const ivBuf = Buffer.from(iv, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Serialises an `EncryptedToken` for single-column DB storage.
 *
 * Format: `v1:<iv_hex>:<ciphertext_hex>`
 *
 * The `v1` prefix reserves space for future algorithm/format versions so key
 * rotation can be implemented transparently by the decryption path.
 */
export function serializeEncryptedToken({ iv, ciphertext }: EncryptedToken): string {
  return `v1:${iv}:${ciphertext}`;
}

/**
 * Parses a serialised token column value produced by `serializeEncryptedToken`.
 *
 * @throws If the format is unrecognised or missing fields.
 */
export function parseEncryptedToken(serialized: string): EncryptedToken {
  const parts = serialized.split(':');
  // v1:<iv>:<ciphertext> — iv and ciphertext are hex, neither contains ':'
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error(`Unrecognised encrypted token format; expected "v1:<iv>:<ciphertext>"`);
  }
  const [, iv, ciphertext] = parts as [string, string, string];
  return { iv, ciphertext };
}

/**
 * Compares two values using a timing-safe equality check.
 *
 * Use for webhook secret validation to prevent timing-based side-channel
 * attacks. Both arguments are compared as UTF-8 buffers of equal length;
 * if lengths differ, the function returns false without leaking which is
 * longer (lengths themselves can leak, but the comparison loop does not).
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
