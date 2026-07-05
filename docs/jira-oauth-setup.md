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

- **Permissions** → add **Jira platform REST API** and grant the one Jira scope
  NiteOwl needs (see `JIRA_OAUTH_SCOPE` in `apps/api/src/lib/jira-oauth.ts`):
  - `read:jira-work`

  This is the only scope you add in the Permissions page. The app may have extra
  scopes enabled — that's fine — but it must grant at least `read:jira-work`, and
  NiteOwl must not request a scope the app lacks or Atlassian bounces the user to
  Home.

  > **`offline_access` is NOT a Permissions scope — do not look for it there.**
  > It is a standard OAuth 2.0 scope that grants the rotating refresh token, and
  > per [Atlassian's docs](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
  > you enable it simply by adding it to the **scope parameter of the
  > authorization URL** — which NiteOwl already does. There is nothing to toggle
  > in the developer console for it.

- **Authorization** → **OAuth 2.0 (3LO)** → **Configure** → set the **Callback URL**
  to **exactly** `{API_URL}/auth/jira/callback` — same scheme, host, port, and
  path, **no trailing slash**. A mismatch here is the #1 cause of the
  "stuck on Atlassian Home" symptom.
- **Settings** → copy the **Client ID** and **Secret** into `JIRA_CLIENT_ID` /
  `JIRA_CLIENT_SECRET`. Double-check the Client ID belongs to the **same app**
  you set the callback + scope on — a `.env` `JIRA_CLIENT_ID` pointing at a
  different app makes Atlassian reject the request **after** login (silent bounce
  to Home).
- **Distribution** → set **Sharing** to **Enabled** (it asks for a Vendor name +
  privacy-policy URL; any reasonable values are fine). A newly-created 3LO app is
  in **developer mode**, which only works for the app's creator account and can
  silently bounce everyone else to the Atlassian Home page after login. Enabling
  Distribution removes that restriction.

> The scopes in the authorize request must be a subset of what the app is
> configured to grant. If NiteOwl requests a scope the app doesn't have,
> Atlassian returns the user to their Home page instead of the consent screen.

Also make sure the Atlassian account you **log in with** during Connect owns (or
can access) at least one **Jira site** (`https://<name>.atlassian.net`) — the
consent has nothing to grant otherwise.

### 2. API environment variables

Set these on the `apps/api` service (see `.env.example`):

| Variable              | Purpose                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JIRA_CLIENT_ID`      | Atlassian app Client ID                                                                                                                                                                                                                                                                                                             |
| `JIRA_CLIENT_SECRET`  | Atlassian app Secret                                                                                                                                                                                                                                                                                                                |
| `API_URL`             | Public origin of the API — builds `redirect_uri` = `${API_URL}/auth/jira/callback`, which must match the console Callback URL **exactly**. Defaults to `http://localhost:3001` (the API's port). If unset it must still resolve to the port the API actually listens on — a `:3000` vs `:3001` mismatch is a silent bounce-to-Home. |
| `WEB_URL`             | Public origin of the web app — where the callback returns the user (defaults to `http://localhost:5173`).                                                                                                                                                                                                                           |
| `JIRA_WEBHOOK_SECRET` | Shared secret in the Jira webhook URL (`?token=…`); only needed for live webhook ingestion, not for OAuth connect.                                                                                                                                                                                                                  |
| `DB_ENCRYPTION_KEY`   | AES-256-GCM key used to encrypt the stored access/refresh tokens (shared with all integrations).                                                                                                                                                                                                                                    |

> **`API_URL` correctness is NOT proven by GitHub working.** GitHub OAuth sends
> no `redirect_uri` — it uses its app-registered callback and never reads
> `API_URL`. Linear and Jira _do_ send `redirect_uri = ${API_URL}/auth/<provider>/callback`,
> so a wrong/unset `API_URL` breaks only those two. Confirm `API_URL` is set to
> the exact origin (scheme + host + **port**) you registered as the Jira callback.

## Troubleshooting

| Symptom                                                                                                   | Likely cause                                                                                                                                                                                                                                       | Fix                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in → **Atlassian Home / start.atlassian.com**, no consent, never returns                             | Callback URL in the console ≠ `{API_URL}/auth/jira/callback`, or the app lacks the `read:jira-work` scope                                                                                                                                          | Make the Callback URL an exact match; add the Jira platform REST API permission with `read:jira-work` (`offline_access` needs nothing added — it's requested in the flow) |
| NiteOwl shows **"Jira OAuth not configured"** (HTTP 503) before reaching Atlassian                        | `JIRA_CLIENT_ID` unset on the API                                                                                                                                                                                                                  | Set `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` and restart the API                                                                                                           |
| Returns to NiteOwl with `status=error&error=state_mismatch`                                               | State cookie lost (blocked third-party cookies, or `API_URL` host differs between connect and callback)                                                                                                                                            | Ensure the connect and callback both use the same `API_URL` host                                                                                                          |
| Bounces to Atlassian Home even after a clean/private-window sign-in, **and GitHub connects fine**         | `API_URL` unset or wrong, so NiteOwl sends a `redirect_uri` on the wrong port/host (e.g. `:3000`) that doesn't match your `:3001` callback. GitHub is unaffected — it sends no `redirect_uri`.                                                     | Set `API_URL` in `.env` to the exact origin you registered as the callback (default `http://localhost:3001`) and restart the API                                          |
| Already-signed-in users bounce to `start.atlassian.com`, but a fresh sign-in works                        | Known Atlassian session edge case when the callback URL isn't an exact match                                                                                                                                                                       | Make the Callback URL exact; a full Atlassian sign-out also clears it                                                                                                     |
| Login → redirects → Atlassian Home, but pressing **Back** reveals the "Authorise App" consent             | App is in **developer mode** (works only for the creator), or an already-authenticated Atlassian session drops the redirect                                                                                                                        | Enable **Distribution** (above); do a clean attempt in a fresh/incognito window; if it still bounces, press Back once to the consent and Accept                           |
| Consent Accept returns to NiteOwl with **"session state invalid, please start again"** (`state_mismatch`) | Stale one-time `state`: the `state` cookie is single-use and lasts ~15 min. Reaching consent via the **Back button**, clicking **Connect** more than once per attempt, or taking >15 min replays an old `state` that no longer matches the cookie. | Do **one** clean attempt: fresh/incognito window, click **Connect Jira once**, go straight through Accept within ~15 min, and don't click Connect again mid-flow.         |
| Returns `status=error&error=no_site`                                                                      | Token has no accessible Jira sites                                                                                                                                                                                                                 | Ensure the connecting Atlassian user has access to at least one Jira site and granted it during consent                                                                   |

## Verifying a successful connect

After a successful connect the API has stored the integration; you can confirm the
poller is wired by calling `POST /api/integrations/jira/catchup` (authenticated) —
it should return `{ "success": true, "data": { "ingested": <n> } }`.
