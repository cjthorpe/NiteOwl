// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Origin/Referer allowlist — CSRF defense-in-depth for cookie-auth routes.
 *
 * Background (FUL-134 / threat assessment FUL-119): the `niteowl_refresh`
 * cookie already uses `SameSite=Strict; HttpOnly; path=/auth`, which is the
 * primary CSRF control. This util is a second, independent layer: it rejects
 * cookie-authenticated state-changing requests whose `Origin`/`Referer` header
 * resolves to an origin we do not serve a browser app from.
 *
 * Policy when neither header is present: ALLOW. A missing Origin/Referer is the
 * normal shape of a non-browser client (curl, native app, server-to-server),
 * and browsers cannot be coerced into omitting `Origin` on a genuine
 * cross-site state-changing fetch. The SameSite=Strict cookie remains the hard
 * gate; this layer only acts on the positive signal of a *present, foreign*
 * origin. This deliberately avoids breaking legitimate header-less callers.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Parse a URL string into its origin (`scheme://host[:port]`); null if invalid. */
function toOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    // Not an absolute URL (or `Origin: null` from a sandboxed/opaque context).
    return null;
  }
}

/**
 * Build the set of allowed browser origins from environment configuration.
 *
 * Sources, mirroring the rest of the API:
 *   - `CORS_ORIGIN` — may be a comma-separated list (matches @fastify/cors).
 *   - `WEB_URL`     — the SPA root used for OAuth redirects.
 *
 * Falls back to the dev SPA origin when nothing is configured, matching the
 * `CORS_ORIGIN ?? 'http://localhost:5173'` default in `buildApp`.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const out = new Set<string>();

  const corsOrigin = env['CORS_ORIGIN'];
  if (corsOrigin) {
    for (const part of corsOrigin.split(',')) {
      const origin = toOrigin(part.trim());
      if (origin) out.add(origin);
    }
  }

  const webOrigin = toOrigin(env['WEB_URL']);
  if (webOrigin) out.add(webOrigin);

  if (out.size === 0) out.add('http://localhost:5173');

  return out;
}

/**
 * Decide whether a request's Origin/Referer is acceptable.
 *
 * Checks `Origin` first (the trustworthy, browser-set value), then falls back
 * to `Referer` for contexts that omit `Origin` (e.g. top-level GET
 * navigations). Returns true when neither header is present — see the policy
 * note at the top of this file.
 */
export function isOriginAllowed(
  headers: { origin?: string | undefined; referer?: string | undefined },
  allowed: Set<string>,
): boolean {
  if (headers.origin !== undefined) {
    const origin = toOrigin(headers.origin);
    return origin !== null && allowed.has(origin);
  }

  if (headers.referer !== undefined) {
    const origin = toOrigin(headers.referer);
    return origin !== null && allowed.has(origin);
  }

  // No Origin and no Referer — non-browser client; rely on SameSite cookie.
  return true;
}

/**
 * Fastify preHandler factory enforcing the Origin/Referer allowlist.
 *
 * Pass an explicit `allowed` set to pin the allowlist (e.g. in tests); when
 * omitted it is resolved per-request from `process.env` so the check always
 * reflects current configuration. Rejects with `403` and a generic message —
 * the offending origin is logged server-side, never echoed to the client.
 */
export function originCheck(allowed?: Set<string>) {
  return async function originCheckPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const allowlist = allowed ?? allowedOrigins();
    const headers = {
      origin: request.headers.origin,
      referer: request.headers.referer,
    };

    if (!isOriginAllowed(headers, allowlist)) {
      request.log.warn(
        { origin: headers.origin, referer: headers.referer },
        'CSRF origin check rejected request',
      );
      await reply.code(403).send({ success: false, error: 'Origin not allowed' });
    }
  };
}
