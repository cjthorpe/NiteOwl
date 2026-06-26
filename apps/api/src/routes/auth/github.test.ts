/**
 * Integration tests for the GitHub OAuth auth routes (FUL-99).
 *
 * Two behaviours are pinned here:
 *   1. The authorize redirect requests `public_repo` (the scope that bounds us
 *      to public repos — the private-repo limitation documented in FUL-99).
 *   2. The post-login backfill uses the deterministic repo-scan source
 *      (`/user/repos` + `/repos/.../commits`), NOT the user-scoped Events API
 *      (`/users/{login}/events`), and persists the *real* granted scopes on the
 *      token row rather than the stale `user:email`.
 *
 * Uses Fastify inject + a chainable DB mock so no HTTP server or Postgres is
 * needed. `fetch` is stubbed and routed by URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildApp } from '../../app.js';
import { generateOAuthState } from '../../lib/crypto.js';

// ── DB mock ──────────────────────────────────────────────────────────────────
// Every `.limit()` resolves to `selectRows`, so seeding a single existing row
// drives the callback down the "existing user / integration / token" branches.
let selectRows: unknown[] = [];
const setCalls: Array<Record<string, unknown>> = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => Promise.resolve(selectRows)),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockImplementation(() => Promise.resolve([{ id: 'integration-1' }])),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockImplementation((arg: Record<string, unknown>) => {
    setCalls.push(arg);
    return mockDb;
  }),
  // The post-login backfill stamps lastSyncedAt via `update().set().where().catch()`;
  // expose a `.catch` on the chain so that fire-and-forget call resolves cleanly.
  catch: vi.fn().mockReturnValue(undefined),
};

// ── fetch mock — routes GitHub REST calls by URL ─────────────────────────────
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';
  process.env['GITHUB_CLIENT_ID'] = 'gh-client-id';
  process.env['GITHUB_CLIENT_SECRET'] = 'gh-client-secret';
  selectRows = [];
  setCalls.length = 0;

  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.innerJoin.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.limit.mockImplementation(() => Promise.resolve(selectRows));
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.returning.mockImplementation(() => Promise.resolve([{ id: 'integration-1' }]));
  mockDb.update.mockReturnThis();
  mockDb.set.mockImplementation((arg: Record<string, unknown>) => {
    setCalls.push(arg);
    return mockDb;
  });
  mockDb.catch.mockReturnValue(undefined);

  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('login/oauth/access_token')) {
      return jsonResponse({ access_token: 'gh-access-token' });
    }
    // Order matters: match the more specific `/user/...` paths before `/user`.
    if (url.includes('/user/repos')) return jsonResponse([]); // repo-scan: no repos
    if (url.includes('/user/emails')) return jsonResponse([]);
    if (url.endsWith('api.github.com/user')) {
      return jsonResponse({
        id: 4242,
        login: 'octocat',
        email: 'octocat@example.com',
        name: 'The Octocat',
        avatar_url: 'https://example.com/a.png',
      });
    }
    // Any Events API hit is a regression — fail loudly.
    if (url.includes('/events')) throw new Error(`unexpected Events API call: ${url}`);
    return jsonResponse([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /auth/github (authorize)', () => {
  it('requests the public_repo scope', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: 'GET', url: '/auth/github' });

    expect(res.statusCode).toBe(302);
    const location = res.headers['location'] as string;
    const scope = new URL(location).searchParams.get('scope');
    expect(scope).toBe('user:email,public_repo');
  });
});

describe('GET /auth/github/callback (post-login backfill)', () => {
  it('persists the real granted scopes and runs the repo-scan, not the Events API', async () => {
    // Seed an existing user so the callback links rather than creates.
    selectRows = [{ id: 'user-001', email: 'octocat@example.com' }];

    const state = generateOAuthState();
    const app = buildApp({ db: mockDb as never });

    const res = await app.inject({
      method: 'GET',
      url: `/auth/github/callback?code=abc123&state=${state}`,
      cookies: { niteowl_oauth_state: state },
    });

    // Success redirect back to the web app's callback page.
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/auth/callback?provider=github&status=success');

    // The token row must record the scopes GitHub actually granted (FUL-99),
    // not the stale `user:email`.
    const scopeWrite = setCalls.find((c) => 'scopes' in c);
    expect(scopeWrite?.['scopes']).toBe('user:email,public_repo');

    // The background backfill is fire-and-forget — let its first fetch resolve.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/user/repos'),
        expect.anything(),
      );
    });

    // And it must never fall back to the user-scoped Events API.
    for (const [calledUrl] of fetchMock.mock.calls) {
      expect(String(calledUrl)).not.toContain('/events');
    }
  });
});
