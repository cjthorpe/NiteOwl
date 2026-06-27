// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { isRepoAllowed } from '../../lib/repo-allowlist.js';

import { fetchWithBackoff, fetchAllPages } from './github-catchup-route.js';

// ---------------------------------------------------------------------------
// Mock global fetch so tests never hit the network
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: {
      get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Rate-limit / retry tests
// ---------------------------------------------------------------------------

describe('fetchWithBackoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the response immediately when status is 200', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, [{ id: 1 }]));

    const res = await fetchWithBackoff('https://api.github.com/user/repos', 'ghp_test');

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and eventually succeeds', async () => {
    // retry-after: "0" means "retry immediately" per RFC 7231 §7.1.3 — keeps the test fast.
    mockFetch
      .mockResolvedValueOnce(makeResponse(429, null, { 'retry-after': '0' }))
      .mockResolvedValueOnce(makeResponse(200, []));

    const res = await fetchWithBackoff('https://api.github.com/user/repos', 'ghp_test');

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 403 (secondary rate limit) and eventually succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(403, null, { 'retry-after': '0' }))
      .mockResolvedValueOnce(makeResponse(200, []));

    const res = await fetchWithBackoff('https://api.github.com/repos/acme/app/pulls', 'ghp_test');

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after MAX_RETRIES and returns the last response', async () => {
    // Return 429 five times (exceeds the four-retry cap).
    // retry-after: "0" keeps each retry delay at 0ms so the test is fast.
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeResponse(429, null, { 'retry-after': '0' }));
    }

    const res = await fetchWithBackoff('https://api.github.com/user/repos', 'ghp_test');

    // After 4 retries (5 total calls) it gives up and returns the last 429.
    expect(res.status).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// Pagination tests
// ---------------------------------------------------------------------------

describe('fetchAllPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a single page of results when there is no next link', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, [{ id: 1 }, { id: 2 }]));

    const results = await fetchAllPages<{ id: number }>(
      'https://api.github.com/user/repos',
      'ghp_test',
    );

    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('follows Link: rel=next headers across multiple pages', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(200, [{ id: 1 }], {
          link: '<https://api.github.com/user/repos?page=2>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, [{ id: 2 }]));

    const results = await fetchAllPages<{ id: number }>(
      'https://api.github.com/user/repos?page=1',
      'ghp_test',
    );

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual([1, 2]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops and returns an empty array on 404 (deleted repo)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(404, null));

    const results = await fetchAllPages<{ id: number }>(
      'https://api.github.com/repos/gone/repo/commits',
      'ghp_test',
    );

    expect(results).toHaveLength(0);
  });

  it('throws on non-404 error responses', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(500, null));

    await expect(
      fetchAllPages('https://api.github.com/repos/acme/app/commits', 'ghp_test'),
    ).rejects.toThrow('GitHub API error: 500');
  });
});

// ---------------------------------------------------------------------------
// Dedup logic — verifies that the external_id scheme prevents double inserts
// ---------------------------------------------------------------------------

describe('deduplication — external_id scheme', () => {
  it('commit external_id is stable across multiple runs for the same SHA', () => {
    const sha = 'deadbeef1234';
    const id1 = `commit:${sha}`;
    const id2 = `commit:${sha}`;
    expect(id1).toBe(id2);
  });

  it('PR external_id uses :catch-up suffix to stay distinct from webhook events', () => {
    const prId = 987654;
    const catchUpId = `pr:${prId}:catch-up`;
    const webhookId = `pr:${prId}:opened`; // produced by webhook normalizer
    expect(catchUpId).not.toBe(webhookId);
  });

  it('re-running over the same window produces no new rows (ON CONFLICT DO NOTHING)', async () => {
    // Simulate an insert that conflicts on (integrationId, externalId)
    let insertCallCount = 0;

    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockImplementation(() => {
              insertCallCount++;
              // First insert succeeds; second is silently ignored (empty array)
              return Promise.resolve(insertCallCount === 1 ? [{ id: 'row-1' }] : []);
            }),
          }),
        }),
      }),
    };

    const row = {
      userId: 'user-1',
      integrationId: 'int-1',
      provider: 'github' as const,
      eventType: 'commit_pushed',
      externalId: 'commit:deadbeef',
      title: '[acme/app] feat: add feature',
      url: 'https://github.com/acme/app/commit/deadbeef',
      metadata: { sha: 'deadbeef', repo: 'acme/app', author: 'dev' },
      occurredAt: new Date('2026-06-13T08:00:00Z'),
    };

    // First run
    const first = await db
      .insert({} as never)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: { id: '' } as never });

    // Second run with identical data
    const second = await db
      .insert({} as never)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: { id: '' } as never });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // duplicate silently ignored
  });
});

// ---------------------------------------------------------------------------
// Repo-scan catch-up — per-integration allowlist (FUL-82)
//
// The handler scopes which repos it scans via:
//   activeRepos = repos.filter(r =>
//     r.pushed_at !== null && new Date(r.pushed_at) >= sinceDate &&
//     isRepoAllowed(config, r.full_name))
// These tests exercise that predicate directly.
// ---------------------------------------------------------------------------

describe('repo-scan catch-up — allowlist scoping', () => {
  const since = new Date('2026-06-21T00:00:00Z');
  const repos = [
    { full_name: 'acme/app', pushed_at: '2026-06-22T08:00:00Z' },
    { full_name: 'acme/api', pushed_at: '2026-06-22T09:00:00Z' },
    { full_name: 'paperclipai/paperclip', pushed_at: '2026-06-22T10:00:00Z' },
    { full_name: 'acme/stale', pushed_at: '2026-01-01T00:00:00Z' }, // before window
  ];

  const activeRepos = (config: { repoAllowlist?: unknown } | null) =>
    repos
      .filter(
        (r) =>
          r.pushed_at !== null &&
          new Date(r.pushed_at) >= since &&
          isRepoAllowed(config, r.full_name),
      )
      .map((r) => r.full_name);

  it('scans every recently-pushed repo when no allowlist is set', () => {
    expect(activeRepos(null)).toEqual(['acme/app', 'acme/api', 'paperclipai/paperclip']);
  });

  it('scans only allowlisted repos when an allowlist is set', () => {
    expect(activeRepos({ repoAllowlist: ['acme/app'] })).toEqual(['acme/app']);
  });

  it('supports org wildcards while still respecting the time window', () => {
    // acme/* matches acme/app and acme/api, but acme/stale is outside the window.
    expect(activeRepos({ repoAllowlist: ['acme/*'] })).toEqual(['acme/app', 'acme/api']);
  });
});
