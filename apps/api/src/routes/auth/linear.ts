import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { generateOAuthState, sha256, timingSafeCompare } from '../../lib/crypto.js';
import { REFRESH_COOKIE } from './constants.js';

const STATE_COOKIE = 'niteowl_linear_state';

interface LinearTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope: string;
}

interface LinearViewer {
  id: string;
  name: string;
  email: string;
  organization: {
    id: string;
    name: string;
    urlKey: string;
  };
}

async function exchangeLinearCode(code: string, redirectUri: string): Promise<LinearTokenResponse> {
  const clientId = process.env['LINEAR_CLIENT_ID'];
  const clientSecret = process.env['LINEAR_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('Linear OAuth not configured');
  }

  const res = await fetch('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to exchange Linear code: ${text}`);
  }

  return res.json() as Promise<LinearTokenResponse>;
}

async function getLinearViewer(accessToken: string): Promise<LinearViewer> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query { viewer { id name email organization { id name urlKey } } }`,
    }),
  });

  if (!res.ok) throw new Error('Failed to fetch Linear viewer');

  const data = (await res.json()) as {
    data?: { viewer?: LinearViewer };
    errors?: unknown[];
  };

  if (data.errors || !data.data?.viewer) {
    throw new Error('GraphQL error fetching Linear viewer');
  }

  return data.data.viewer;
}

export const linearAuthRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3000';
  const redirectUri = `${apiUrl}/auth/linear/callback`;

  // ── GET /auth/linear ── Initiate Linear OAuth ─────────────────────────────
  fastify.get(
    '/linear',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const clientId = process.env['LINEAR_CLIENT_ID'];
      const webRoot = process.env['WEB_URL'] ?? 'http://localhost:5173';

      if (!clientId) {
        return reply.code(503).send({ success: false, error: 'Linear OAuth not configured' });
      }

      // Resolve the authenticated user: first try the Bearer token, then fall
      // back to the refresh cookie (which IS sent to /auth/* paths). This
      // allows browser-initiated GET navigations — e.g. from the onboarding
      // page — to work without an explicit Authorization header.
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
      // Embed userId in state cookie so the callback can associate the token
      // with the correct user without requiring a Bearer header.
      const stateCookieValue = JSON.stringify({ state, userId });

      reply.setCookie(STATE_COOKIE, stateCookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/auth/linear',
        maxAge: 900, // 15 minutes
      });

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'read',
        state,
      });

      return reply.redirect(`https://linear.app/oauth/authorize?${params.toString()}`, 302);
    },
  );

  // ── GET /auth/linear/callback ── Exchange code, store integration ─────────
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>(
    '/linear/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { code, state, error } = request.query;
      const webRoot = process.env['WEB_URL'] ?? 'http://localhost:5173';
      const successRedirect = `${webRoot}/auth/callback?provider=linear&status=success`;
      const errorRedirect = (msg: string) =>
        `${webRoot}/auth/callback?provider=linear&status=error&error=${encodeURIComponent(msg)}`;

      if (error) {
        return reply.redirect(errorRedirect(error), 302);
      }

      const rawStateCookie = request.cookies[STATE_COOKIE];

      // Parse the state cookie (contains both state and userId)
      let storedState: string | null = null;
      let cookieUserId: string | null = null;
      if (rawStateCookie) {
        try {
          const parsed = JSON.parse(rawStateCookie) as { state?: string; userId?: string };
          storedState = parsed.state ?? null;
          cookieUserId = parsed.userId ?? null;
        } catch {
          // malformed cookie — treat as missing
        }
      }

      if (!state || !storedState || !timingSafeCompare(state, storedState)) {
        return reply.redirect(errorRedirect('state_mismatch'), 302);
      }

      reply.clearCookie(STATE_COOKIE, { path: '/auth/linear' });

      if (!code) {
        return reply.redirect(errorRedirect('no_code'), 302);
      }

      // Resolve userId: prefer Bearer token, fall back to cookie-embedded userId
      const userId = request.user?.sub ?? cookieUserId;
      if (!userId) {
        return reply.redirect(`${webRoot}/login?error=session_expired`, 302);
      }

      try {
        const tokenData = await exchangeLinearCode(code, redirectUri);
        const viewer = await getLinearViewer(tokenData.access_token);
        const { id: organizationId, name: organizationName } = viewer.organization;

        // Upsert integration record
        const [existing] = await db
          .select({ id: schema.integrations.id })
          .from(schema.integrations)
          .where(
            and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, 'linear')),
          )
          .limit(1);

        if (existing) {
          await db
            .update(schema.integrations)
            .set({
              configJson: { organizationId, organizationName },
              enabled: true,
              connectedAt: new Date(),
            })
            .where(eq(schema.integrations.id, existing.id));
        } else {
          await db.insert(schema.integrations).values({
            userId,
            provider: 'linear',
            configJson: { organizationId, organizationName },
            enabled: true,
          });
        }

        // Upsert OAuth token record.
        // NOTE: accessTokenEncrypted stores the raw token here.
        // In production this should be AES-256-GCM encrypted at the app layer.
        const tokenExpiresAt =
          tokenData.expires_in != null ? new Date(Date.now() + tokenData.expires_in * 1000) : null;

        const [existingToken] = await db
          .select({ id: schema.oauthTokens.id })
          .from(schema.oauthTokens)
          .where(
            and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, 'linear')),
          )
          .limit(1);

        if (existingToken) {
          await db
            .update(schema.oauthTokens)
            .set({
              accessTokenEncrypted: tokenData.access_token,
              scopes: tokenData.scope,
              ...(tokenExpiresAt != null ? { expiresAt: tokenExpiresAt } : {}),
              updatedAt: new Date(),
            })
            .where(eq(schema.oauthTokens.id, existingToken.id));
        } else {
          await db.insert(schema.oauthTokens).values({
            userId,
            provider: 'linear',
            accessTokenEncrypted: tokenData.access_token,
            scopes: tokenData.scope,
            ...(tokenExpiresAt != null ? { expiresAt: tokenExpiresAt } : {}),
          });
        }

        return reply.redirect(successRedirect, 302);
      } catch (err) {
        // Log the real error server-side; never expose internal details
        // (API error bodies, stack traces, etc.) in the redirect URL.
        fastify.log.error({ err }, 'Linear OAuth callback error');
        return reply.redirect(errorRedirect('server_error'), 302);
      }
    },
  );
};
