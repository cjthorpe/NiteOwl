// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex digest — used to store refresh token fingerprint in DB */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 32 cryptographically random bytes as a URL-safe base64 string */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Random hex string for OAuth state parameter (16 bytes = 32 hex chars) */
export function generateOAuthState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * PKCE (RFC 7636) verifier/challenge pair for Authorization Code flows that
 * support it (e.g. Atlassian 3LO). The verifier is a high-entropy URL-safe
 * secret kept server-side; the S256 challenge is sent on the authorize
 * redirect and re-derived at token-exchange time to prove the same client
 * completed both legs of the flow.
 */
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Timing-safe string comparison — use for any security-sensitive equality
 * check (OAuth state, webhook signatures, CSRF tokens) to prevent
 * timing-based side-channel attacks.
 *
 * Returns false (never throws) when lengths differ.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
