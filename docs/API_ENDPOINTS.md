# NiteOwl API Endpoints

A complete list of every HTTP endpoint exposed by the `@niteowl/api` service
(`apps/api`), with `curl` examples for each. Generated for **FUL-78**.

## Base URL & conventions

- **Local base URL:** `http://localhost:3001` (`PORT` / `API_PORT`, default `3001`).
- **Response envelope:** most endpoints return JSON. Auth + webhook endpoints use
  `{ success, data?, error? }`; resource endpoints return the resource directly
  (e.g. `{ integrations: [...] }`).
- **Authentication:** protected routes require a JWT **Bearer** token:
  `Authorization: Bearer <accessToken>`. Obtain `accessToken` from
  `POST /auth/login` or `POST /auth/register` (`data.accessToken`).
- **Refresh/logout** rely on the `refresh_token` **cookie** set at login — use
  `curl -c cookies.txt` / `-b cookies.txt` to persist it.
- **Webhooks** are unauthenticated by JWT; they are verified by provider HMAC
  signatures (or a shared token for Jira), so plain `curl` calls will be rejected
  unless correctly signed.
- **Rate limits:** global 200 req/min per IP; auth + OAuth routes 20/min; catch-up
  routes 3–10/min; webhooks 500/min.

To use the authenticated examples below, capture a token first:

```bash
export BASE=http://localhost:3001
export TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
```

---

## Health (public)

| Method | Path          | Auth | Description                |
| ------ | ------------- | ---- | -------------------------- |
| GET    | `/health`     | none | Liveness/health status     |
| GET    | `/api/health` | none | Same payload, API-prefixed |

```bash
curl "$BASE/health"
curl "$BASE/api/health"
```

---

## Auth — prefix `/auth`

| Method | Path                    | Auth                     | Body / Notes                                              |
| ------ | ----------------------- | ------------------------ | --------------------------------------------------------- |
| POST   | `/auth/register`        | none                     | `{ email, password, displayName? }` (password 8–72 chars) |
| POST   | `/auth/login`           | none                     | `{ email, password }`                                     |
| POST   | `/auth/refresh`         | refresh cookie           | Rotates access token from `refresh_token` cookie          |
| POST   | `/auth/logout`          | refresh cookie           | Revokes the refresh token                                 |
| GET    | `/auth/github`          | none                     | Browser redirect to GitHub OAuth                          |
| GET    | `/auth/github/callback` | none                     | OAuth callback (GitHub redirects here)                    |
| GET    | `/auth/linear`          | Bearer or refresh cookie | Browser redirect to Linear OAuth                          |
| GET    | `/auth/linear/callback` | none                     | OAuth callback (Linear redirects here)                    |

```bash
# Register
curl -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"supersecret","displayName":"You"}'

# Login (capture cookie for refresh/logout)
curl -c cookies.txt -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"supersecret"}'

# Refresh access token
curl -b cookies.txt -X POST "$BASE/auth/refresh"

# Logout
curl -b cookies.txt -X POST "$BASE/auth/logout"

# OAuth start endpoints (follow redirects in a browser)
curl -i "$BASE/auth/github"
curl -i -H "Authorization: Bearer $TOKEN" "$BASE/auth/linear"
```

---

## Feed — prefix `/api/feed`

| Method | Path        | Auth   | Query params                                                                         |
| ------ | ----------- | ------ | ------------------------------------------------------------------------------------ |
| GET    | `/api/feed` | Bearer | `hours`, `since` (`last_login`), `provider`, `eventType`, `repo`, `author`, `cursor` |

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/feed?hours=24"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/feed?since=last_login&provider=github"
```

---

## Integrations — prefix `/api/integrations`

| Method | Path                                                | Auth   | Body / Notes                                              |
| ------ | --------------------------------------------------- | ------ | --------------------------------------------------------- |
| GET    | `/api/integrations`                                 | Bearer | List the user's integrations (incl. `repoAllowlist`)      |
| PATCH  | `/api/integrations/:id`                             | Bearer | `{ enabled?: boolean, repoAllowlist?: string[] }`         |
| DELETE | `/api/integrations/providers/:provider`             | Bearer | `provider` ∈ `github\|linear\|jira\|slack`; clears tokens |
| POST   | `/api/integrations/linear/catchup`                  | Bearer | Backfill last 24h of Linear issues                        |
| POST   | `/api/integrations/github/sync`                     | Bearer | Fire-and-forget GitHub catch-up (202)                     |
| POST   | `/api/integrations/github/:installationId/catch-up` | Bearer | `{ since: ISO, until: ISO }`                              |

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/integrations"

curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' "$BASE/api/integrations/<integrationId>"

# Restrict a GitHub integration to specific repos (empty array = allow all).
# Matching is case-insensitive on owner/repo; "owner/*" allows a whole org.
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"repoAllowlist":["acme/app","acme/*"]}' "$BASE/api/integrations/<integrationId>"

curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/integrations/providers/github"

curl -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/integrations/linear/catchup"

curl -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/integrations/github/sync"

curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"since":"2026-06-01T00:00:00Z","until":"2026-06-21T00:00:00Z"}' \
  "$BASE/api/integrations/github/<installationId>/catch-up"
```

---

## Webhooks — prefix `/api/webhooks` (provider-signed, no JWT)

| Method | Path                           | Auth                       | Notes         |
| ------ | ------------------------------ | -------------------------- | ------------- |
| POST   | `/api/webhooks/github`         | HMAC `x-hub-signature-256` | GitHub events |
| POST   | `/api/webhooks/linear`         | Linear signature           | Linear events |
| POST   | `/api/webhooks/jira?token=...` | shared `token` query       | Jira events   |

```bash
# These require valid provider signatures; an unsigned call is rejected.
curl -X POST "$BASE/api/webhooks/github" \
  -H 'x-github-event: ping' -H 'x-hub-signature-256: sha256=...' \
  -H 'Content-Type: application/json' -d '{}'

curl -X POST "$BASE/api/webhooks/linear" -H 'Content-Type: application/json' -d '{}'

curl -X POST "$BASE/api/webhooks/jira?token=<shared-token>" \
  -H 'Content-Type: application/json' -d '{}'
```

---

## Slack alerts — prefix `/api/slack-alerts`

| Method | Path                         | Auth   | Body / Notes                                               |
| ------ | ---------------------------- | ------ | ---------------------------------------------------------- |
| GET    | `/api/slack-alerts`          | Bearer | List configs                                               |
| POST   | `/api/slack-alerts`          | Bearer | `{ webhookUrl, watchedRepos?, botUserLogins? }`            |
| PATCH  | `/api/slack-alerts/:id`      | Bearer | `{ webhookUrl?, watchedRepos?, botUserLogins?, enabled? }` |
| DELETE | `/api/slack-alerts/:id`      | Bearer | Returns 204                                                |
| POST   | `/api/slack-alerts/:id/test` | Bearer | Sends a test message                                       |

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/slack-alerts"

curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"webhookUrl":"https://hooks.slack.com/services/T/B/X","watchedRepos":["acme/app"]}' \
  "$BASE/api/slack-alerts"

curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' "$BASE/api/slack-alerts/<id>"

curl -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/api/slack-alerts/<id>"

curl -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/slack-alerts/<id>/test"
```

---

## Agent logins — prefix `/api/agent-logins`

| Method | Path                    | Auth   | Body / Notes                 |
| ------ | ----------------------- | ------ | ---------------------------- |
| GET    | `/api/agent-logins`     | Bearer | List registered agent logins |
| POST   | `/api/agent-logins`     | Bearer | `{ integration, login }`     |
| DELETE | `/api/agent-logins/:id` | Bearer | Remove an agent login        |

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/agent-logins"

curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"integration":"github","login":"dependabot[bot]"}' "$BASE/api/agent-logins"

curl -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/api/agent-logins/<id>"
```

---

## Users — prefix `/api/users`

| Method | Path            | Auth   | Notes                                      |
| ------ | --------------- | ------ | ------------------------------------------ |
| GET    | `/api/users/me` | Bearer | Current user (derived from JWT, no DB hit) |

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/users/me"
```

---

### Summary count

**28 endpoints** across 8 groups: Health (2), Auth (8), Feed (1),
Integrations (6), Webhooks (3), Slack alerts (5), Agent logins (3), Users (1).
