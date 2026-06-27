// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { sha256 } from '../../lib/crypto.js';
import { signAccessToken, signRefreshToken } from '../../lib/jwt.js';

import { REFRESH_COOKIE } from './constants.js';
import { emailAuthRoutes } from './email.js';
import { githubAuthRoutes } from './github.js';
import { linearAuthRoutes } from './linear.js';
import { passwordResetRoutes } from './password-reset.js';
import { tokenRoutes } from './tokens.js';

export const authRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, opts) => {
  const { db } = opts;

  // ── Email/password register + login ───────────────────────────────────────
  void fastify.register(emailAuthRoutes, { ...opts, prefix: '' });

  // ── GitHub OAuth ──────────────────────────────────────────────────────────
  void fastify.register(githubAuthRoutes, { ...opts, prefix: '' });

  // ── Linear OAuth ──────────────────────────────────────────────────────────
  void fastify.register(linearAuthRoutes, { ...opts, prefix: '' });

  // ── Password reset (forgot-password + reset-password) ─────────────────────
  void fastify.register(passwordResetRoutes, { ...opts, prefix: '' });

  // ── Personal access tokens (create / list / revoke) ───────────────────────
  void fastify.register(tokenRoutes, { ...opts, prefix: '' });

  // ── POST /auth/refresh ────────────────────────────────────────────────────
  fastify.post('/refresh', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const rawToken = request.cookies[REFRESH_COOKIE];
      if (!rawToken) {
        return reply.code(401).send({ success: false, error: 'No refresh token' });
      }

      const tokenHash = sha256(rawToken);
      const now = new Date();

      // Look up the token regardless of rotated_at so we can distinguish:
      //   not found at all       → invalid / never issued (or expired & purged)
      //   rotatedAt IS NOT NULL  → replay of a consumed token — indicates theft
      //   rotatedAt IS NULL      → valid, rotate normally
      const [stored] = await db
        .select({
          id: schema.refreshTokens.id,
          userId: schema.refreshTokens.userId,
          rotatedAt: schema.refreshTokens.rotatedAt,
          expiresAt: schema.refreshTokens.expiresAt,
        })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);

      if (!stored) {
        // Token was never issued or has been fully purged — not a replay.
        void reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
        return reply.code(401).send({ success: false, error: 'Invalid or expired refresh token' });
      }

      // ── Replay detection (nuclear option) ────────────────────────────────
      // A rotated token that is presented again means the session was cloned or
      // the token was stolen. Revoke every active token for this user to force
      // full re-authentication.
      if (stored.rotatedAt !== null) {
        await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, stored.userId));
        void reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
        return reply.code(401).send({
          success: false,
          error: 'Refresh token already used — all sessions revoked',
        });
      }

      // ── Check expiry on a still-active token ─────────────────────────────
      if (stored.expiresAt <= now) {
        void reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
        return reply.code(401).send({ success: false, error: 'Invalid or expired refresh token' });
      }

      const [user] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          lastSeenAt: schema.users.lastSeenAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, stored.userId))
        .limit(1);

      if (!user) {
        return reply.code(401).send({ success: false, error: 'User not found' });
      }

      // ── Rotate: soft-mark the consumed token, issue a fresh one ──────────
      await db
        .update(schema.refreshTokens)
        .set({ rotatedAt: now })
        .where(eq(schema.refreshTokens.id, stored.id));

      const { token: newRawRefresh, expiresAt: newExpiresAt } = await signRefreshToken(
        user.id,
        user.email,
      );

      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(newRawRefresh),
        expiresAt: newExpiresAt,
      });

      void reply.setCookie(REFRESH_COOKIE, newRawRefresh, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/auth',
        expires: newExpiresAt,
      });

      // Snapshot the current last_seen_at into the new access token, then
      // advance last_seen_at to now. Consumers that call ?since=last_login on
      // the feed see the window from the previous session start.
      const snapshotLastSeenAt = user.lastSeenAt;
      await db.update(schema.users).set({ lastSeenAt: now }).where(eq(schema.users.id, user.id));

      const accessToken = await signAccessToken(user.id, user.email, snapshotLastSeenAt);

      return reply.send({
        success: true,
        data: { accessToken },
        error: null,
      });
    },
  });

  // ── POST /auth/logout ─────────────────────────────────────────────────────
  fastify.post('/logout', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const rawToken = request.cookies[REFRESH_COOKIE];

      if (rawToken) {
        const tokenHash = sha256(rawToken);
        await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash));
      }

      void reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });

      return reply.send({ success: true, data: null, error: null });
    },
  });
};
