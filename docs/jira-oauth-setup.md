<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 Fullstack Forge -->

# Connecting Jira (Atlassian 3LO) — operator setup

NiteOwl connects to Jira Cloud with Atlassian's OAuth 2.0 **three-legged (3LO)**
flow, mirroring the GitHub and Linear integrations. The code is in
`apps/api/src/routes/auth/jira.ts`; this doc covers the one-time **configuration**
the flow depends on. Unlike GitHub/Linear, the Jira leg cannot work until the
Atlassian developer-console app is configured, because Atlassian validates the
callback URL and scopes on its side before it will ever return to NiteOwl.

## What is supposed to happen

1. In NiteOwl, the user clicks **Connect Jira**. The browser navigates to
   `GET {API_URL}/auth/jira`.
2. That route resolves the signed-in user, sets a short-lived state cookie
   (with a PKCE verifier), and 302-redirects to
   `https://auth.atlassian.com/authorize?...` with
   `redirect_uri={API_URL}/auth/jira/callback`.
3. Atlassian shows **Log in to continue** (if needed), then a **consent screen**
   ("NiteOwl wants to access your Atlassian account"). The user picks the site
   and clicks **Accept**.
4. Atlassian 302-redirects back to `{API_URL}/auth/jira/callback?code=…&state=…`.
   The callback exchanges the code, calls
   `GET https://api.atlassian.com/oauth/token/accessible-resources` to learn the
   `cloudId` + `siteUrl`, persists the integration + encrypted tokens, and
   redirects the browser to `{WEB_URL}/auth/callback?provider=jira&status=success`.
5. NiteOwl exchanges the refresh cookie for an access token and shows Jira as
   connected.

**Symptom of a misconfigured app:** the user reaches the Atlassian login, signs
in, and then lands on the **Atlassian Home / `start.atlassian.com`** page — no
consent screen, and NiteOwl never regains control. Atlassian silently drops the
authorization request (rather than showing an error) when the callback URL or
scopes don't line up. See Troubleshooting below.

## Required configuration

### 1. Atlassian developer console (the usual culprit)

In <https://developer.atlassian.com/console/myapps/> → your app:

- **Permissions** → add **Jira platform REST API**, and enable the scopes NiteOwl
  requests (see `JIRA_OAUTH_SCOPE` in `apps/api/src/lib/jira-oauth.ts`):
  - `read:jira-work`
  - `read:jira-user`
  - `offline_access` (grants the rotating refresh token the catch-up poller needs)
- **Authorization** → **OAuth 2.0 (3LO)** → **Configure** → set the **Callback URL**
  to **exactly** `{API_URL}/auth/jira/callback` — same scheme, host, port, and
  path, **no trailing slash**. A mismatch here is the #1 cause of the
  "stuck on Atlassian Home" symptom.
- **Settings** → copy the **Client ID** and **Secret**.

> The scopes in the authorize request must be a subset of what the app is
> configured to grant. If NiteOwl requests a scope the app doesn't have,
> Atlassian returns the user to their Home page instead of the consent screen.

### 2. API environment variables

Set these on the `apps/api` service (see `.env.example`):

| Variable              | Purpose                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `JIRA_CLIENT_ID`      | Atlassian app Client ID                                                                                            |
| `JIRA_CLIENT_SECRET`  | Atlassian app Secret                                                                                               |
| `API_URL`             | Public origin of the API — used to build `redirect_uri`. Must match the console Callback URL host.                 |
| `WEB_URL`             | Public origin of the web app — where the callback returns the user.                                                |
| `JIRA_WEBHOOK_SECRET` | Shared secret in the Jira webhook URL (`?token=…`); only needed for live webhook ingestion, not for OAuth connect. |
| `DB_ENCRYPTION_KEY`   | AES-256-GCM key used to encrypt the stored access/refresh tokens (shared with all integrations).                   |

`API_URL` and `WEB_URL` are the same values GitHub/Linear already use — if those
integrations connect successfully, these are correct and the Jira-specific gap is
in the console app or the `JIRA_*` variables.

## Troubleshooting

| Symptom                                                                            | Likely cause                                                                                             | Fix                                                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sign in → **Atlassian Home / start.atlassian.com**, no consent, never returns      | Callback URL in the console ≠ `{API_URL}/auth/jira/callback`, or the app is missing the requested scopes | Correct the Callback URL to an exact match; add the Jira REST API permission with all three scopes      |
| NiteOwl shows **"Jira OAuth not configured"** (HTTP 503) before reaching Atlassian | `JIRA_CLIENT_ID` unset on the API                                                                        | Set `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` and restart the API                                         |
| Returns to NiteOwl with `status=error&error=state_mismatch`                        | State cookie lost (blocked third-party cookies, or `API_URL` host differs between connect and callback)  | Ensure the connect and callback both use the same `API_URL` host                                        |
| Already-signed-in users bounce to `start.atlassian.com`, but a fresh sign-in works | Known Atlassian session edge case when the callback URL isn't an exact match                             | Make the Callback URL exact; a full Atlassian sign-out also clears it                                   |
| Returns `status=error&error=no_site`                                               | Token has no accessible Jira sites                                                                       | Ensure the connecting Atlassian user has access to at least one Jira site and granted it during consent |

## Verifying a successful connect

After a successful connect the API has stored the integration; you can confirm the
poller is wired by calling `POST /api/integrations/jira/catchup` (authenticated) —
it should return `{ "success": true, "data": { "ingested": <n> } }`.
