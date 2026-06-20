import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyToken, type TokenPayload } from '../lib/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenPayload | null;
  }
}

/**
 * Decodes the Bearer JWT on every request and attaches `request.user`.
 * Does NOT reject requests without a token — route handlers decide that.
 * Use `requireAuth` helper to guard individual routes.
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('user', null);

  fastify.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const token = header.slice(7);
    try {
      request.user = await verifyToken(token);
    } catch {
      // Invalid/expired token — leave request.user as null
    }
  });
};

export default fp(authPlugin, { name: 'auth' });

/** Prehandler that rejects requests without a verified JWT */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
}
