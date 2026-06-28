# CSRF posture

> **Decision lineage:** Threat assessment [FUL-119](/FUL/issues/FUL-119#document-threat-assessment)
> scoped the CSRF surface; hardening + invariant-locking implemented in
> [FUL-134](/FUL/issues/FUL-134).

NiteOwl has two request-authentication surfaces, and CSRF applies to only one of
them.

## The two surfaces

| Surface   | Authenticates via            | CSRF-exposed?  |
| --------- | ---------------------------- | -------------- |
| `/api/*`  | `Authorization: Bearer` only | **No**         |
| `/auth/*` | `niteowl_refresh` cookie     | Yes (hardened) |

### `/api/*` is CSRF-immune by construction

Every mutating `/api/*` route authenticates from the `Authorization: Bearer`
header (JWT or PAT), decoded in `apps/api/src/plugins/auth.ts`. A browser will
not attach that header to a forged cross-site request, and cookies are never
consulted for `/api/*` auth. There is therefore no CSRF surface here.

This is a load-bearing assumption, so it is **locked by a regression test**: a
`POST /api/agent-logins` carrying only a session cookie (no Bearer) must return
`401`. If a future change ever wires cookie auth into the API surface, that test
breaks. See `apps/api/src/routes/auth/auth.test.ts`
(_"Invariant: /api/\* mutations do not accept cookie auth"_).

### `/auth/*` is cookie-authenticated → hardened

The only cookie-auth surface is `/auth/*`. The `niteowl_refresh` cookie is the
primary CSRF control:

```
Set-Cookie: niteowl_refresh=…; HttpOnly; Secure; SameSite=Strict; Path=/auth
```

`SameSite=Strict` means the browser withholds the cookie from any cross-site
request, so a forged `POST /auth/refresh` from an attacker page never carries
the victim's session. `Secure` is applied in production; `HttpOnly` keeps the
token out of reach of page JavaScript.

## Defense-in-depth: Origin/Referer allowlist

On top of `SameSite`, cookie-auth mutating routes run an **Origin/Referer
allowlist** preHandler (`apps/api/src/lib/origin-check.ts`). It is applied to:

- `POST /auth/refresh`
- `POST /auth/logout`
- `GET  /auth/linear` (the init path falls back to the refresh cookie to resolve
  the user, so it is a cookie-auth surface despite being a GET)
- `POST /auth/login` and `POST /auth/register` (login-CSRF — see below)

**Behaviour:**

- The allowlist is derived from `CORS_ORIGIN` (comma-separated list supported)
  and `WEB_URL`, normalized to origins. With nothing configured it falls back to
  the dev SPA origin `http://localhost:5173`, matching the CORS default.
- If a request carries an `Origin` header, it must resolve to an allowlisted
  origin, else `403`. `Origin` is checked first because it is the trustworthy,
  browser-set value.
- If `Origin` is absent, the check falls back to `Referer`.
- **If neither header is present, the request is allowed.** A missing
  Origin/Referer is the normal shape of a non-browser client (curl, native app,
  server-to-server). Browsers cannot be coerced into omitting `Origin` on a
  genuine cross-site state-changing `fetch`, so this policy does not weaken the
  control — `SameSite=Strict` remains the hard gate, and the allowlist only acts
  on the positive signal of a _present, foreign_ origin.

The rejected origin is logged server-side (`warn`) and never echoed to the
client; the response is a generic `{ success: false, error: 'Origin not allowed' }`.

## Login-CSRF decision

`POST /auth/login` and `POST /auth/register` are not cookie-_authenticated_
(they accept credentials in the body), so classic CSRF does not apply. They do,
however, set the session cookie, so a forged cross-origin submission could log a
victim into an attacker-controlled account (_login-CSRF_).

**Decision (core MVP):** the Origin/Referer allowlist is the proportionate
control and is applied to both routes; a forged submission from a foreign origin
is rejected with `403`. A full synchroniser-token / double-submit anti-CSRF
token for the unauthenticated login form is **out of scope for the core MVP** —
it requires a pre-session token-issuance endpoint and form plumbing whose value
is marginal once SameSite + Origin checks are in place. Revisit if/when the login
form must support embedding in contexts where the Origin header is unreliable.

## Cookie-attribute audit

All auth cookies were audited (FUL-134). No divergences were found; rationale per
cookie:

| Cookie                 | HttpOnly | Secure (prod) | SameSite | Path           | Rationale                                                                                                                                                                                                  |
| ---------------------- | -------- | ------------- | -------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `niteowl_refresh`      | ✅       | ✅            | `Strict` | `/auth`        | Session credential — never sent cross-site; scoped to the auth path that consumes it.                                                                                                                      |
| `niteowl_oauth_state`  | ✅       | ✅            | `Lax`    | `/auth/github` | OAuth CSRF-state nonce. **`Lax` is required**: the value must survive the top-level GET redirect back from GitHub, which `Strict` would strip. Integrity is guaranteed by the state nonce, not the cookie. |
| `niteowl_linear_state` | ✅       | ✅            | `Lax`    | `/auth/linear` | Same as above for the Linear OAuth redirect.                                                                                                                                                               |

The two `Lax` state cookies are the only deviation from `Strict`, and it is
deliberate: an OAuth provider's redirect is a cross-site top-level navigation, so
`Strict` would discard the state nonce and break the callback's CSRF check.
