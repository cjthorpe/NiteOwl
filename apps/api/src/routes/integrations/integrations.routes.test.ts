import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';

/**
 * Regression test for FUL-75.
 *
 * The nested catch-up plugins (GitHub `/github/sync`, Linear `/linear/catchup`)
 * were registered by re-passing the parent plugin's `opts`, which still carried
 * `prefix: '/api/integrations'`. Fastify applies a `prefix` option additively,
 * so the routes ended up mounted at `/api/integrations/api/integrations/...`
 * and the documented paths returned 404 "Route not found".
 *
 * These tests assert the routes resolve at their documented paths. We expect
 * 401 (rejected by `requireAuth`) rather than 404 — proving the route exists
 * and is reachable without needing a valid token.
 */
describe('integrations route mounting (FUL-75)', () => {
  it('mounts POST /api/integrations/github/sync (not 404)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/github/sync',
    });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(401);
  });

  it('mounts POST /api/integrations/linear/catchup (not 404)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/linear/catchup',
    });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(401);
  });

  it('does NOT mount the doubled-prefix path', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/api/integrations/github/sync',
    });
    expect(res.statusCode).toBe(404);
  });
});
