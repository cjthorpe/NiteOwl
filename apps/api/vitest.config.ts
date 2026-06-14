import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // drizzle-orm ships ESM + CJS; inline it so Vite resolves it correctly in tests.
    server: {
      deps: {
        inline: [
          'drizzle-orm',
          'postgres',
          '@fastify/cookie',
          'fastify-plugin',
          'fastify',
          '@fastify/cors',
          '@fastify/rate-limit',
        ],
      },
    },
  },
});
