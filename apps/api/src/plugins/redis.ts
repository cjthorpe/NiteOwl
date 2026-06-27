// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const client = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
  });

  // Non-fatal: if Redis is unavailable the app still serves requests (no cache)
  client.on('error', (err: unknown) => {
    fastify.log.warn({ err }, 'Redis error');
  });

  try {
    await client.connect();
  } catch (err) {
    fastify.log.warn({ err }, 'Redis unavailable — caching disabled');
  }

  fastify.decorate('redis', client);

  fastify.addHook('onClose', async () => {
    await client.quit().catch(() => undefined);
  });
};

export default fp(redisPlugin, { name: 'redis' });
