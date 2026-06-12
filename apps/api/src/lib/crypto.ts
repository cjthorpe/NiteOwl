import { createHash, randomBytes } from "node:crypto";

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
