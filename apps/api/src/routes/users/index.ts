import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../plugins/auth.js';

export const usersRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/users/me
   *
   * Returns the authenticated user's profile fields derived from the JWT.
   * `lastSeenAt` is the snapshot captured at session open — it represents the
   * start of the user's *previous* session and is stable for the lifetime of
   * the current access token.
   */
  fastify.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const { sub: id, email, lastSeenAt } = request.user!;
    return reply.code(200).send({
      success: true,
      data: { id, email, lastSeenAt },
      error: null,
    });
  });
};
