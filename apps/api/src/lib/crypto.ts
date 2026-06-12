import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 hex digest — used to store refresh token fingerprint in DB */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 32 cryptographically random bytes as a URL-safe base64 string */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Random hex string for OAuth state parameter (16 bytes = 32 hex chars) */
export function generateOAuthState(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Timing-safe string comparison — use for any security-sensitive equality
 * check (OAuth state, webhook signatures, CSRF tokens) to prevent
 * timing-based side-channel attacks.
 *
 * Returns false (never throws) when lengths differ.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
