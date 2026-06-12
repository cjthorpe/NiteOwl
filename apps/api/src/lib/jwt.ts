import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const ACCESS_TOKEN_TTL = "1h";
const REFRESH_TOKEN_TTL = "7d";
const REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;

export interface TokenPayload extends JWTPayload {
  sub: string; // userId
  email: string;
}

function getSecret(): Uint8Array {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET env var is not set");
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  userId: string,
  email: string,
): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

export async function signRefreshToken(
  userId: string,
  email: string,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MS);
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(getSecret());
  return { token, expiresAt };
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ["HS256"],
  });
  if (!payload.sub || typeof payload["email"] !== "string") {
    throw new Error("Invalid token payload");
  }
  return payload as TokenPayload;
}
