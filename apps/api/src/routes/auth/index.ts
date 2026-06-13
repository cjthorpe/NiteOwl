import { and, eq, gt } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";

import { sha256 } from "../../lib/crypto.js";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";
import { emailAuthRoutes } from "./email.js";
import { githubAuthRoutes } from "./github.js";

const REFRESH_COOKIE = "niteowl_refresh";

export const authRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  // ── Email/password register + login ───────────────────────────────────────
  fastify.register(emailAuthRoutes, { ...opts, prefix: "" });

  // ── GitHub OAuth ──────────────────────────────────────────────────────────
  fastify.register(githubAuthRoutes, { ...opts, prefix: "" });

  // ── POST /auth/refresh ────────────────────────────────────────────────────
  fastify.post("/refresh", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const rawToken = request.cookies[REFRESH_COOKIE];
      if (!rawToken) {
        return reply.code(401).send({ success: false, error: "No refresh token" });
      }

      const tokenHash = sha256(rawToken);
      const now = new Date();

      const [stored] = await db
        .select({
          id: schema.refreshTokens.id,
          userId: schema.refreshTokens.userId,
        })
        .from(schema.refreshTokens)
        .where(
          and(
            eq(schema.refreshTokens.tokenHash, tokenHash),
            gt(schema.refreshTokens.expiresAt, now),
          ),
        )
        .limit(1);

      if (!stored) {
        reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
        return reply.code(401).send({ success: false, error: "Invalid or expired refresh token" });
      }

      const [user] = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, stored.userId))
        .limit(1);

      if (!user) {
        return reply.code(401).send({ success: false, error: "User not found" });
      }

      // Rotating refresh token: delete the consumed token and issue a new one.
      await db
        .delete(schema.refreshTokens)
        .where(eq(schema.refreshTokens.id, stored.id));

      const { token: newRawRefresh, expiresAt: newExpiresAt } =
        await signRefreshToken(user.id, user.email);

      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(newRawRefresh),
        expiresAt: newExpiresAt,
      });

      reply.setCookie(REFRESH_COOKIE, newRawRefresh, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env["NODE_ENV"] === "production",
        path: "/auth",
        expires: newExpiresAt,
      });

      const accessToken = await signAccessToken(user.id, user.email);

      return reply.send({
        success: true,
        data: { accessToken },
        error: null,
      });
    },
  });

  // ── POST /auth/logout ─────────────────────────────────────────────────────
  fastify.post("/logout", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const rawToken = request.cookies[REFRESH_COOKIE];

      if (rawToken) {
        const tokenHash = sha256(rawToken);
        await db
          .delete(schema.refreshTokens)
          .where(eq(schema.refreshTokens.tokenHash, tokenHash));
      }

      reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });

      return reply.send({ success: true, data: null, error: null });
    },
  });
};
