import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { generateOpaqueToken, sha256 } from '../../lib/crypto.js';
import { appBaseUrl, buildPasswordResetEmail, sendEmail } from '../../lib/email.js';
import { hashPassword } from '../../lib/password.js';

/** Reset tokens are valid for 30 minutes from creation. */
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Generic response returned by /forgot-password regardless of whether the
 * account exists. Identical body on every path prevents account enumeration.
 */
const GENERIC_FORGOT_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

interface ForgotPasswordBody {
  email: string;
}

interface ResetPasswordBody {
  token: string;
  password: string;
}

export const passwordResetRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  // ── POST /auth/forgot-password ────────────────────────────────────────────
  // Always returns 200 with a generic message. If the user exists AND has a
  // password (i.e. is not OAuth-only), a single-use reset token is created and
  // emailed. Tighter rate limit than login: each call can trigger an email.
  fastify.post<{ Body: ForgotPasswordBody }>('/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
    handler: async (request, reply) => {
      const { email } = request.body;

      const [user] = await db
        .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      // Only issue a token for password-backed accounts. OAuth-only users have
      // no passwordHash and must sign in via their provider. Either way we
      // return the same generic 200 below.
      if (user && user.passwordHash) {
        const rawToken = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        // Invalidate any outstanding tokens for this user so only the most
        // recent reset link works, and to bound table growth under abuse.
        await db
          .delete(schema.passwordResetTokens)
          .where(eq(schema.passwordResetTokens.userId, user.id));

        await db.insert(schema.passwordResetTokens).values({
          userId: user.id,
          tokenHash: sha256(rawToken),
          expiresAt,
        });

        const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
        const message = buildPasswordResetEmail(email, resetUrl);

        // Fire-and-forget: don't let email latency (or failure) change the
        // response time or status, which would leak whether the account exists.
        // Failures are logged server-side for operability.
        void sendEmail(message).catch((err: unknown) => {
          request.log.error({ err }, 'Failed to send password reset email');
        });
      }

      return reply.send({
        success: true,
        data: { message: GENERIC_FORGOT_MESSAGE },
        error: null,
      });
    },
  });

  // ── POST /auth/reset-password ─────────────────────────────────────────────
  // Consumes a single-use token: validates it, sets the new password, marks the
  // token used, and revokes every refresh token for the user to force re-login
  // on all devices. All writes run in one transaction for atomicity.
  fastify.post<{ Body: ResetPasswordBody }>('/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', minLength: 1 },
          // Same length rule as register (bcrypt's 72-byte ceiling).
          password: { type: 'string', minLength: 8, maxLength: 72 },
        },
      },
    },
    handler: async (request, reply) => {
      const { token, password } = request.body;
      const tokenHash = sha256(token);
      const now = new Date();

      // The token lookup runs INSIDE the transaction with SELECT … FOR UPDATE
      // so concurrent redemptions of the same token are serialised at the row
      // level. Without this lock two simultaneous requests could both pass an
      // out-of-transaction validity check and race to set different passwords.
      let tokenValid = false;

      await db.transaction(async (tx) => {
        const [stored] = await tx
          .select({
            id: schema.passwordResetTokens.id,
            userId: schema.passwordResetTokens.userId,
          })
          .from(schema.passwordResetTokens)
          .where(
            and(
              eq(schema.passwordResetTokens.tokenHash, tokenHash),
              isNull(schema.passwordResetTokens.usedAt),
              gt(schema.passwordResetTokens.expiresAt, now),
            ),
          )
          .for('update')
          .limit(1);

        // Lost the race (already used/expired) or never existed → leave the
        // transaction without writing; the handler returns a generic 400.
        if (!stored) return;
        tokenValid = true;

        const passwordHash = await hashPassword(password);

        // Set the new password.
        await tx
          .update(schema.users)
          .set({ passwordHash, updatedAt: now })
          .where(eq(schema.users.id, stored.userId));

        // Consume the token (single-use). Safe under the row lock above.
        await tx
          .update(schema.passwordResetTokens)
          .set({ usedAt: now })
          .where(eq(schema.passwordResetTokens.id, stored.id));

        // Revoke every refresh token for the user — forces re-login everywhere.
        await tx.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, stored.userId));
      });

      if (!tokenValid) {
        return reply.code(400).send({ success: false, error: 'Invalid or expired reset token' });
      }

      return reply.send({
        success: true,
        data: { message: 'Password has been reset. Please sign in with your new password.' },
        error: null,
      });
    },
  });
};
