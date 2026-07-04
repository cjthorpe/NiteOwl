// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Atlassian 3LO (three-legged OAuth) protocol helpers.
 *
 * Unlike Linear/GitHub — whose tokens are effectively long-lived — Atlassian
 * access tokens expire (~1h) and refresh tokens ROTATE on every use. The token
 * exchange/refresh calls here always return a fresh `refresh_token` that MUST be
 * persisted; dropping it 400s the next refresh (see FUL-123 plan, trap #2).
 *
 * Endpoints:
 *   authorize            https://auth.atlassian.com/authorize
 *   token / refresh      https://auth.atlassian.com/oauth/token
 *   accessible-resources https://api.atlassian.com/oauth/token/accessible-resources
 */

export const JIRA_AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
export const JIRA_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
export const JIRA_ACCESSIBLE_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources';

/**
 * Requested scopes — kept to the minimum the catch-up poller actually uses
 * (least privilege). `read:jira-work` covers the only REST call we make
 * (`/rest/api/3/search/jql`), including the assignee/reporter display names
 * returned inline on each issue. `offline_access` is REQUIRED to receive a
 * refresh token — without it Atlassian returns an access token only and the
 * poller cannot survive the ~1h expiry window.
 *
 * We deliberately do NOT request `read:jira-user` (the `/user` endpoints),
 * which the code never calls: asking for a scope the operator's OAuth app has
 * not granted is a known cause of Atlassian silently bouncing the user to
 * their Home page after login instead of showing the consent screen. Keeping
 * the request minimal maximises the chance a freshly-configured app connects.
 */
export const JIRA_OAUTH_SCOPE = 'read:jira-work offline_access';

export interface JiraTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type: string;
}

export interface JiraAccessibleResource {
  /** The Atlassian cloudId — used for `api.atlassian.com/ex/jira/{cloudId}` REST calls. */
  id: string;
  /** Site base URL, e.g. https://acme.atlassian.net — used for webhook `issue.self` matching. */
  url: string;
  name: string;
  scopes?: string[];
  avatarUrl?: string;
}

function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env['JIRA_CLIENT_ID'];
  const clientSecret = process.env['JIRA_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('Jira OAuth not configured');
  }
  return { clientId, clientSecret };
}

/**
 * Exchange an authorization code for tokens (PKCE-protected).
 */
export async function exchangeJiraCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<JiraTokenResponse> {
  const { clientId, clientSecret } = requireCredentials();

  const res = await fetch(JIRA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to exchange Jira code: ${res.status}`);
  }

  return res.json() as Promise<JiraTokenResponse>;
}

/**
 * Redeem a rotating refresh token for a new access + refresh token pair.
 * The returned `refresh_token` supersedes the one passed in — persist it.
 */
export async function refreshJiraToken(refreshToken: string): Promise<JiraTokenResponse> {
  const { clientId, clientSecret } = requireCredentials();

  const res = await fetch(JIRA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh Jira token: ${res.status}`);
  }

  return res.json() as Promise<JiraTokenResponse>;
}

/**
 * List the Jira sites this token can access. The first entry's `id` is the
 * cloudId and `url` is the siteUrl — both must be persisted (plan trap #3).
 */
export async function getJiraAccessibleResources(
  accessToken: string,
): Promise<JiraAccessibleResource[]> {
  const res = await fetch(JIRA_ACCESSIBLE_RESOURCES_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Jira accessible resources: ${res.status}`);
  }

  return res.json() as Promise<JiraAccessibleResource[]>;
}
