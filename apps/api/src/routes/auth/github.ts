import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { generateOAuthState, sha256, timingSafeCompare } from '../../lib/crypto.js';
import { signRefreshToken } from '../../lib/jwt.js';
import { runGitHubCatchup } from '../../lib/github-catchup.js';

import { REFRESH_COOKIE } from './constants.js';

const STATE_COOKIE = 'niteowl_oauth_state';

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function getGitHubToken(code: string): Promise<string> {
  const clientId = process.env['GITHUB_CLIENT_ID'];
  const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth not configured');
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!res.ok) throw new Error('Failed to exchange GitHub code');

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error ?? 'No access_token in GitHub response');
  }
  return data.access_token;
}

async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to fetch GitHub user');
  return res.json() as Promise<GitHubUser>;
}

async function getGitHubPrimaryEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const emails = (await res.json()) as GitHubEmail[];
  const primary = emails.find((e) => e.primary && e.verified);
  return primary?.email ?? null;
}

export const githubAuthRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  fastify.get(
    '/github',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const clientId = process.env['GITHUB_CLIENT_ID'];
      if (!clientId) {
        return reply.code(503).send({ success: false, error: 'GitHub OAuth not configured' });
      }

      const state = generateOAuthState();

      reply.setCookie(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/auth/github',
        maxAge: 900, // 15 minutes
      });

      const params = new URLSearchParams({
        client_id: clientId,
        scope: 'user:email',
        state,
      });

      return reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`, 302);
    },
  );

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/github/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { code, state, error } = request.query;
      const webRoot = process.env['WEB_URL'] ?? 'http://localhost:5173';

      if (error) {
        return reply.redirect(`${webRoot}/login?error=${encodeURIComponent(error)}`, 302);
      }

      const storedState = request.cookies[STATE_COOKIE];
      // Timing-safe comparison prevents state oracle attacks.
      if (!state || !storedState || !timingSafeCompare(state, storedState)) {
        return reply.redirect(`${webRoot}/login?error=state_mismatch`, 302);
      }

      reply.clearCookie(STATE_COOKIE, { path: '/auth/github' });

      if (!code) {
        return reply.redirect(`${webRoot}/login?error=no_code`, 302);
      }

      try {
        const ghToken = await getGitHubToken(code);
        const ghUser = await getGitHubUser(ghToken);

        const email = ghUser.email ?? (await getGitHubPrimaryEmail(ghToken));

        if (!email) {
          return reply.redirect(`${webRoot}/login?error=no_email`, 302);
        }

        const githubId = String(ghUser.id);

        // Find by githubId first, then fall back to email
        let [user] = await db
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.githubId, githubId))
          .limit(1);

        if (!user) {
          // Try matching by email (account linking)
          const [existing] = await db
            .select({ id: schema.users.id, email: schema.users.email })
            .from(schema.users)
            .where(eq(schema.users.email, email))
            .limit(1);

          if (existing) {
            // Link GitHub to existing email account
            await db
              .update(schema.users)
              .set({ githubId, avatarUrl: ghUser.avatar_url, updatedAt: new Date() })
              .where(eq(schema.users.id, existing.id));
            user = existing;
          } else {
            // Brand new user
            const [created] = await db
              .insert(schema.users)
              .values({
                email,
                displayName: ghUser.name ?? ghUser.login,
                avatarUrl: ghUser.avatar_url,
                githubId,
              })
              .returning({ id: schema.users.id, email: schema.users.email });
            if (!created) throw new Error('Failed to create user');
            user = created;
          }
        }

        const { token: rawRefresh, expiresAt } = await signRefreshToken(user.id, user.email);

        await db.insert(schema.refreshTokens).values({
          userId: user.id,
          tokenHash: sha256(rawRefresh),
          expiresAt,
        });

        reply.setCookie(REFRESH_COOKIE, rawRefresh, {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env['NODE_ENV'] === 'production',
          path: '/auth',
          expires: expiresAt,
        });

        // Register GitHub as a connected integration and store the OAuth token
        // so the activity feed can ingest events server-side.
        const userId = user.id;

        const [existingIntegration] = await db
          .select({ id: schema.integrations.id })
          .from(schema.integrations)
          .where(
            and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, 'github')),
          )
          .limit(1);

        let integrationId: string;
        if (existingIntegration) {
          integrationId = existingIntegration.id;
          await db
            .update(schema.integrations)
            .set({ enabled: true, connectedAt: new Date() })
            .where(eq(schema.integrations.id, integrationId));
        } else {
          const [created] = await db
            .insert(schema.integrations)
            .values({ userId, provider: 'github', enabled: true })
            .returning({ id: schema.integrations.id });
          if (!created) throw new Error('Failed to create GitHub integration');
          integrationId = created.id;
        }

        // Upsert OAuth token (raw token stored; encrypt at app layer in prod)
        const [existingToken] = await db
          .select({ id: schema.oauthTokens.id })
          .from(schema.oauthTokens)
          .where(
            and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, 'github')),
          )
          .limit(1);

        if (existingToken) {
          await db
            .update(schema.oauthTokens)
            .set({
              accessTokenEncrypted: ghToken,
              scopes: 'user:email',
              updatedAt: new Date(),
            })
            .where(eq(schema.oauthTokens.id, existingToken.id));
        } else {
          await db.insert(schema.oauthTokens).values({
            userId,
            provider: 'github',
            accessTokenEncrypted: ghToken,
            scopes: 'user:email',
          });
        }

        // Trigger 24-hour activity catchup in background (non-blocking)
        runGitHubCatchup({
          db,
          userId,
          integrationId,
          githubLogin: ghUser.login,
          accessToken: ghToken,
        })
          .then((result) => {
            fastify.log.info(
              { userId, integrationId, ...result },
              'GitHub catchup complete (post-login)',
            );
            // Update lastSyncedAt after catchup
            db.update(schema.integrations)
              .set({ lastSyncedAt: new Date() })
              .where(eq(schema.integrations.id, integrationId))
              .catch(() => {
                /* non-fatal */
              });
          })
          .catch((err: unknown) => {
            fastify.log.error({ err, userId, integrationId }, 'GitHub catchup failed (post-login)');
          });

        // Redirect to frontend; the frontend must call POST /auth/refresh to
        // obtain a short-lived access token from the HttpOnly refresh cookie.
        // Never put access tokens in URLs — they appear in browser history and
        // are readable by any JS on the page (violates OAuth 2.0 Security BCP).
        return reply.redirect(`${webRoot}/auth/callback?provider=github&status=success`, 302);
      } catch (err) {
        // Log server-side so the real error is diagnosable from API logs.
        // Never expose raw error messages to the client — they may contain
        // internal details (DB connection strings, stack traces, etc.)
        fastify.log.error({ err }, 'GitHub OAuth callback error');
        return reply.redirect(`${webRoot}/login?error=server_error`, 302);
      }
    },
  );
};
