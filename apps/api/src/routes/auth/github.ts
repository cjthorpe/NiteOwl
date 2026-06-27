// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { generateOAuthState, sha256, timingSafeCompare } from '../../lib/crypto.js';
import { runGitHubRepoScan } from '../../lib/github-repo-scan.js';
import { signRefreshToken } from '../../lib/jwt.js';

import { REFRESH_COOKIE } from './constants.js';

const STATE_COOKIE = 'niteowl_oauth_state';

/**
 * OAuth scopes requested at authorize time. Single source of truth so the
 * scopes we persist on the token row can never drift from what GitHub actually
 * granted (FUL-99: the row previously claimed `user:email` while the token
 * carried `public_repo` too).
 *
 * NOTE: `public_repo` grants read of **public** repos only. Private-repo
 * activity (`runGitHubRepoScan`'s `/user/repos` + `/repos/{owner}/{repo}/commits`
 * calls) returns nothing under this scope. Tracking private repos requires the
 * full `repo` scope plus a re-consent from every connected user — a privacy
 * escalation gated on board approval, not a silent change (see FUL-99).
 */
const GITHUB_OAUTH_SCOPE = 'user:email,public_repo';

const CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000;

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

      void reply.setCookie(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/auth/github',
        maxAge: 900, // 15 minutes
      });

      const params = new URLSearchParams({
        client_id: clientId,
        scope: GITHUB_OAUTH_SCOPE,
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

      void reply.clearCookie(STATE_COOKIE, { path: '/auth/github' });

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

        void reply.setCookie(REFRESH_COOKIE, rawRefresh, {
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
            .set({
              enabled: true,
              connectedAt: new Date(),
              configJson: { githubLogin: ghUser.login },
            })
            .where(eq(schema.integrations.id, integrationId));
        } else {
          const [created] = await db
            .insert(schema.integrations)
            .values({
              userId,
              provider: 'github',
              enabled: true,
              configJson: { githubLogin: ghUser.login },
            })
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
              scopes: GITHUB_OAUTH_SCOPE,
              updatedAt: new Date(),
            })
            .where(eq(schema.oauthTokens.id, existingToken.id));
        } else {
          await db.insert(schema.oauthTokens).values({
            userId,
            provider: 'github',
            accessTokenEncrypted: ghToken,
            scopes: GITHUB_OAUTH_SCOPE,
          });
        }

        // Trigger a 24-hour activity backfill in the background (non-blocking).
        // FUL-99: this uses the deterministic repo-scan source
        // (`/repos/{owner}/{repo}/commits` + `/pulls`) rather than the
        // user-scoped Events API, mirroring POST /api/integrations/github/sync,
        // so the one-shot post-connect backfill reflects real repo activity
        // (every contributor) instead of only the connecting user's timeline.
        const until = new Date();
        const since = new Date(until.getTime() - CATCHUP_WINDOW_MS);

        runGitHubRepoScan({
          db,
          userId,
          integrationId,
          accessToken: ghToken,
          since,
          until,
          // The configJson written above carries no repoAllowlist, so this
          // initial backfill scans all active repos (FUL-82 allow-all), matching
          // the /github/sync default. Ongoing syncs re-read the persisted config.
          config: null,
          logger: fastify.log,
        })
          .then((result) => {
            fastify.log.info(
              {
                userId,
                integrationId,
                reposScanned: result.reposScanned,
                ingested: result.ingested,
                total: result.total,
                errors: result.errors,
                // Surface the actual per-repo failure. Pino only runs its Error
                // serializer on the `err`/`error` keys, so a raw Error spread
                // under any other key serialises to `{}` (the FUL-98 bug).
                lastErrorMessage: result.lastError?.message,
                lastErrorStack: result.lastError?.stack,
              },
              '[github-repo-scan] post-login backfill complete',
            );
            // Update lastSyncedAt after the backfill.
            db.update(schema.integrations)
              .set({ lastSyncedAt: new Date() })
              .where(eq(schema.integrations.id, integrationId))
              .catch(() => {
                /* non-fatal */
              });
          })
          .catch((err: unknown) => {
            fastify.log.error(
              { err, userId, integrationId },
              '[github-repo-scan] post-login backfill failed',
            );
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
