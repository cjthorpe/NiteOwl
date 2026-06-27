// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { verifyToken, type TokenPayload } from '../lib/jwt.js';
import { isPatToken, verifyPatToken } from '../lib/pat.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenPayload | null;
  }
}

interface AuthPluginOptions {
  /** Injected so the PAT branch can look tokens up; omit to disable PATs. */
  db?: Db;
}

/**
 * Decodes the Bearer credential on every request and attaches `request.user`.
 *
 * Two credential types are accepted, distinguished by a cheap prefix check:
 *   - `niteowl_pat_…` → opaque Personal Access Token, verified via DB lookup.
 *   - anything else    → HS256 JWT, verified via signature.
 *
 * Does NOT reject requests without a valid credential — route handlers decide
 * that. Use the `requireAuth` helper to guard individual routes.
 */
const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const { db } = opts;

  fastify.decorateRequest('user', null);

  fastify.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const token = header.slice(7);

    // ── PAT branch ──────────────────────────────────────────────────────────
    // The prefix lets us route PATs away from the JWT verifier entirely, so a
    // PAT can never be used to probe JWT verification. Invalid/revoked/expired
    // PATs leave request.user null without falling through to the JWT path.
    if (isPatToken(token)) {
      if (!db) return;
      try {
        request.user = await verifyPatToken(db, token);
      } catch (err) {
        // Unexpected lookup failure — fail closed, leave request.user null.
        request.log.error({ err }, 'PAT verification failed');
      }
      return;
    }

    // ── JWT branch ──────────────────────────────────────────────────────────
    try {
      request.user = await verifyToken(token);
    } catch {
      // Invalid/expired token — leave request.user as null
    }
  });
};

export default fp(authPlugin, { name: 'auth' });

/** Prehandler that rejects requests without a verified credential */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
}
