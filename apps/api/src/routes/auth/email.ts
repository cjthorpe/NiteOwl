import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";

import { sha256 } from "../../lib/crypto.js";
import { signAccessToken, signRefreshToken } from "../../lib/jwt.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";

import { REFRESH_COOKIE } from "./constants.js";

interface RegisterBody {
  email: string;
  password: string;
  displayName?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export const emailAuthRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  { db },
) => {
  fastify.post<{ Body: RegisterBody }>("/register", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8, maxLength: 72 },
          displayName: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { email, password, displayName = "" } = request.body;

      const existing = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (existing.length > 0) {
        return reply.code(409).send({ success: false, error: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);

      const [user] = await db
        .insert(schema.users)
        .values({ email, displayName, passwordHash })
        .returning({ id: schema.users.id, email: schema.users.email });

      if (!user) throw new Error("Failed to create user");

      const accessToken = await signAccessToken(user.id, user.email);
      const { token: rawRefresh, expiresAt } = await signRefreshToken(
        user.id,
        user.email,
      );

      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(rawRefresh),
        expiresAt,
      });

      reply.setCookie(REFRESH_COOKIE, rawRefresh, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env["NODE_ENV"] === "production",
        path: "/auth",
        expires: expiresAt,
      });

      return reply.code(201).send({
        success: true,
        data: { accessToken, user: { id: user.id, email: user.email } },
        error: null,
      });
    },
  });

  fastify.post<{ Body: LoginBody }>("/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { email, password } = request.body;

      const [user] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          passwordHash: schema.users.passwordHash,
        })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (!user || !user.passwordHash) {
        return reply
          .code(401)
          .send({ success: false, error: "Invalid credentials" });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return reply
          .code(401)
          .send({ success: false, error: "Invalid credentials" });
      }

      const accessToken = await signAccessToken(user.id, user.email);
      const { token: rawRefresh, expiresAt } = await signRefreshToken(
        user.id,
        user.email,
      );

      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(rawRefresh),
        expiresAt,
      });

      reply.setCookie(REFRESH_COOKIE, rawRefresh, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env["NODE_ENV"] === "production",
        path: "/auth",
        expires: expiresAt,
      });

      return reply.send({
        success: true,
        data: { accessToken, user: { id: user.id, email: user.email } },
        error: null,
      });
    },
  });
};
