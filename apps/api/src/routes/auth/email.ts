// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { sha256 } from '../../lib/crypto.js';
import { signAccessToken, signRefreshToken } from '../../lib/jwt.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';

import { REFRESH_COOKIE } from './constants.js';

interface RegisterBody {
  email: string;
  password: string;
  displayName?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export const emailAuthRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  fastify.post<{ Body: RegisterBody }>('/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8, maxLength: 72 },
          displayName: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { email, password, displayName = '' } = request.body;

      const existing = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (existing.length > 0) {
        return reply.code(409).send({ success: false, error: 'Email already registered' });
      }

      const passwordHash = await hashPassword(password);

      // New users have no previous session — lastSeenAt will be null in the JWT.
      const [user] = await db
        .insert(schema.users)
        .values({ email, displayName, passwordHash })
        .returning({ id: schema.users.id, email: schema.users.email });

      if (!user) throw new Error('Failed to create user');

      // Stamp last_seen_at = now (marks session open; next login will snapshot this).
      await db
        .update(schema.users)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.users.id, user.id));

      // lastSeenAt in the JWT is null for brand-new users (no prior session).
      const accessToken = await signAccessToken(user.id, user.email, null);
      const { token: rawRefresh, expiresAt } = await signRefreshToken(user.id, user.email);

      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(rawRefresh),
        expiresAt,
      });

      void reply.setCookie(REFRESH_COOKIE, rawRefresh, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/auth',
        expires: expiresAt,
      });

      return reply.code(201).send({
        success: true,
        data: { accessToken, user: { id: user.id, email: user.email } },
        error: null,
      });
    },
  });

  fastify.post<{ Body: LoginBody }>('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
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
          lastSeenAt: schema.users.lastSeenAt,
        })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (!user || !user.passwordHash) {
        return reply.code(401).send({ success: false, error: 'Invalid credentials' });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ success: false, error: 'Invalid credentials' });
      }

      // Snapshot the current last_seen_at into the JWT before overwriting it.
      // This lets the feed ?since=last_login window reflect the previous session
      // without collapsing to zero on page refresh within the same session.
      const snapshotLastSeenAt = user.lastSeenAt;
      await db
        .update(schema.users)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.users.id, user.id));

      const accessToken = await signAccessToken(user.id, user.email, snapshotLastSeenAt);
      const { token: rawRefresh, expiresAt } = await signRefreshToken(user.id, user.email);

      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: sha256(rawRefresh),
        expiresAt,
      });

      void reply.setCookie(REFRESH_COOKIE, rawRefresh, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/auth',
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
