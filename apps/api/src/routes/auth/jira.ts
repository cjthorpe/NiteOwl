// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import { schema, encrypt } from '@niteowl/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  generateOAuthState,
  generatePkcePair,
  sha256,
  timingSafeCompare,
} from '../../lib/crypto.js';
import {
  JIRA_AUTHORIZE_URL,
  JIRA_OAUTH_SCOPE,
  exchangeJiraCode,
  getJiraAccessibleResources,
} from '../../lib/jira-oauth.js';

import { REFRESH_COOKIE } from './constants.js';

const STATE_COOKIE = 'niteowl_jira_state';

interface JiraStateCookie {
  state: string;
  userId: string;
  verifier: string;
}

export const jiraAuthRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  // Default matches the API's own listen port (PORT/API_PORT default 3001) and
  // VITE_API_URL — NOT 3000. The redirect_uri built here must be a URL the
  // browser can reach AND the exact callback registered in the Atlassian app;
  // a wrong host/port here makes Atlassian silently bounce the user to their
  // Home page after login (FUL-141). GitHub OAuth never hit this because it
  // sends no redirect_uri.
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001';
  const redirectUri = `${apiUrl}/auth/jira/callback`;

  // ── GET /auth/jira ── Initiate Atlassian 3LO ────────────────────────────────
  fastify.get(
    '/jira',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const clientId = process.env['JIRA_CLIENT_ID'];
      const webRoot = process.env['WEB_URL'] ?? 'http://localhost:5173';

      if (!clientId) {
        return reply.code(503).send({ success: false, error: 'Jira OAuth not configured' });
      }

      // Resolve the authenticated user: Bearer token first, then the refresh
      // cookie (sent to /auth/* paths) so browser-initiated GET navigations from
      // the onboarding page work without an explicit Authorization header.
      let userId = request.user?.sub ?? null;

      if (!userId) {
        const rawRefresh = request.cookies[REFRESH_COOKIE];
        if (rawRefresh) {
          const tokenHash = sha256(rawRefresh);
          const now = new Date();
          const [stored] = await db
            .select({ userId: schema.refreshTokens.userId })
            .from(schema.refreshTokens)
            .where(
              and(
                eq(schema.refreshTokens.tokenHash, tokenHash),
                isNull(schema.refreshTokens.rotatedAt),
                gt(schema.refreshTokens.expiresAt, now),
              ),
            )
            .limit(1);
          userId = stored?.userId ?? null;
        }
      }

      if (!userId) {
        return reply.redirect(`${webRoot}/login?error=session_expired`, 302);
      }

      const state = generateOAuthState();
      const { verifier, challenge } = generatePkcePair();

      // Embed userId + PKCE verifier in the state cookie so the callback can
      // associate the token with the right user and complete the PKCE exchange.
      const stateCookieValue = JSON.stringify({
        state,
        userId,
        verifier,
      } satisfies JiraStateCookie);

      void reply.setCookie(STATE_COOKIE, stateCookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/auth/jira',
        maxAge: 900, // 15 minutes
      });

      const params = new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: clientId,
        scope: JIRA_OAUTH_SCOPE,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });

      return reply.redirect(`${JIRA_AUTHORIZE_URL}?${params.toString()}`, 302);
    },
  );

  // ── GET /auth/jira/callback ── Exchange code, store integration + token ─────
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>(
    '/jira/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { code, state, error } = request.query;
      const webRoot = process.env['WEB_URL'] ?? 'http://localhost:5173';
      const successRedirect = `${webRoot}/auth/callback?provider=jira&status=success`;
      const errorRedirect = (msg: string) =>
        `${webRoot}/auth/callback?provider=jira&status=error&error=${encodeURIComponent(msg)}`;

      if (error) {
        return reply.redirect(errorRedirect(error), 302);
      }

      const rawStateCookie = request.cookies[STATE_COOKIE];

      let storedState: string | null = null;
      let cookieUserId: string | null = null;
      let verifier: string | null = null;
      if (rawStateCookie) {
        try {
          const parsed = JSON.parse(rawStateCookie) as Partial<JiraStateCookie>;
          storedState = parsed.state ?? null;
          cookieUserId = parsed.userId ?? null;
          verifier = parsed.verifier ?? null;
        } catch {
          // malformed cookie — treat as missing
        }
      }

      if (!state || !storedState || !timingSafeCompare(state, storedState)) {
        return reply.redirect(errorRedirect('state_mismatch'), 302);
      }

      void reply.clearCookie(STATE_COOKIE, { path: '/auth/jira' });

      if (!code || !verifier) {
        return reply.redirect(errorRedirect('no_code'), 302);
      }

      const userId = request.user?.sub ?? cookieUserId;
      if (!userId) {
        return reply.redirect(`${webRoot}/login?error=session_expired`, 302);
      }

      try {
        const tokenData = await exchangeJiraCode(code, redirectUri, verifier);
        const resources = await getJiraAccessibleResources(tokenData.access_token);

        const site = resources[0];
        if (!site) {
          fastify.log.error('Jira OAuth: no accessible resources for token');
          return reply.redirect(errorRedirect('no_site'), 302);
        }

        const cloudId = site.id;
        // Normalize the site base URL (strip trailing slash) so webhook host
        // matching against `issue.self` stays exact (plan trap #3).
        const siteUrl = site.url.replace(/\/+$/, '');

        // ── Upsert integration record (persist BOTH cloudId and siteUrl) ──────
        const [existing] = await db
          .select({ id: schema.integrations.id })
          .from(schema.integrations)
          .where(
            and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, 'jira')),
          )
          .limit(1);

        const configJson = { cloudId, siteUrl, siteName: site.name };

        if (existing) {
          await db
            .update(schema.integrations)
            .set({ configJson, enabled: true, connectedAt: new Date() })
            .where(eq(schema.integrations.id, existing.id));
        } else {
          await db.insert(schema.integrations).values({
            userId,
            provider: 'jira',
            configJson,
            enabled: true,
          });
        }

        // ── Upsert OAuth token — AES-GCM encrypted (never plaintext) ──────────
        // Atlassian access tokens expire (~1h) and refresh tokens rotate, so we
        // persist the refresh token + expiresAt for the poller to renew with.
        const tokenExpiresAt =
          tokenData.expires_in != null ? new Date(Date.now() + tokenData.expires_in * 1000) : null;

        const [existingToken] = await db
          .select({ id: schema.oauthTokens.id })
          .from(schema.oauthTokens)
          .where(
            and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, 'jira')),
          )
          .limit(1);

        const tokenValues = {
          accessTokenEncrypted: encrypt(tokenData.access_token),
          refreshTokenEncrypted:
            tokenData.refresh_token != null ? encrypt(tokenData.refresh_token) : null,
          scopes: tokenData.scope ?? JIRA_OAUTH_SCOPE,
          ...(tokenExpiresAt != null ? { expiresAt: tokenExpiresAt } : {}),
        };

        if (existingToken) {
          await db
            .update(schema.oauthTokens)
            .set({ ...tokenValues, updatedAt: new Date() })
            .where(eq(schema.oauthTokens.id, existingToken.id));
        } else {
          await db.insert(schema.oauthTokens).values({ userId, provider: 'jira', ...tokenValues });
        }

        return reply.redirect(successRedirect, 302);
      } catch (err) {
        // Log server-side; never leak internal error detail into the redirect.
        fastify.log.error({ err }, 'Jira OAuth callback error');
        return reply.redirect(errorRedirect('server_error'), 302);
      }
    },
  );
};
