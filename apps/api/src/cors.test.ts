// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

/**
 * Regression coverage for FUL-79.
 *
 * @fastify/cors v11 defaults `methods` to 'GET,HEAD,POST', which omits DELETE
 * and PATCH. With that default the browser preflight blocks the agent-login
 * Remove button (a cross-origin DELETE), so it silently does nothing. The CORS
 * config must advertise every verb the API serves.
 */
describe('CORS preflight allowed methods', () => {
  async function preflight(method: string) {
    const app = buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/agent-logins/some-id',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization',
      },
    });
    return res;
  }

  it('allows DELETE so the agent-login Remove button works', async () => {
    const res = await preflight('DELETE');
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });

  it('allows PATCH for state-changing routes', async () => {
    const res = await preflight('PATCH');
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
  });

  it('still allows the GET and POST verbs the app already relied on', async () => {
    const allowed = (await preflight('POST')).headers['access-control-allow-methods'];
    expect(allowed).toContain('GET');
    expect(allowed).toContain('POST');
  });
});
