// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  encodeRepoPath,
  fetchAllPages,
  RateBudget,
  runGitHubRepoScan,
} from './github-repo-scan.js';

// ---------------------------------------------------------------------------
// Mock global fetch so tests never hit the network. Responses are routed by
// URL: `/user/repos`, `/repos/{repo}/commits`, `/repos/{repo}/pulls`.
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (key: string) => (key.toLowerCase() === 'link' ? '' : null) },
    json: async () => body,
  } as unknown as Response;
}

// A drizzle-like insert stub that records the batch of rows it was handed and
// reports every row as newly inserted (no ON CONFLICT collisions).
function makeDb() {
  const captured: { rows: Array<Record<string, unknown>> } = { rows: [] };
  const db = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((rows: Array<Record<string, unknown>>) => {
        captured.rows = rows;
        return {
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(rows.map((_, i) => ({ id: `row-${i}` }))),
          }),
        };
      }),
    }),
  };
  return { db, captured };
}

const SINCE = new Date('2026-06-25T00:00:00Z');
const UNTIL = new Date('2026-06-26T00:00:00Z');
const inWindow = '2026-06-25T12:00:00Z';

interface RouteConfig {
  repos?: unknown;
  commits?: Record<string, unknown>; // repoFullName → commits[]
  pulls?: Record<string, unknown>; // repoFullName → pulls[]
  commitError?: string[]; // repos whose commits fetch returns 500
}

function routeFetch(cfg: RouteConfig) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/user/repos')) {
      return jsonResponse(cfg.repos ?? []);
    }
    if (url.includes('/commits')) {
      const repo = decodeURIComponent(url.split('/repos/')[1]!.split('/commits')[0]!);
      if (cfg.commitError?.includes(repo)) return jsonResponse(null, 500);
      return jsonResponse(cfg.commits?.[repo] ?? []);
    }
    if (url.includes('/pulls')) {
      const repo = decodeURIComponent(url.split('/repos/')[1]!.split('/pulls')[0]!);
      return jsonResponse(cfg.pulls?.[repo] ?? []);
    }
    return jsonResponse([]);
  });
}

function makeCommit(sha: string, author: string, message = 'feat: change') {
  return {
    sha,
    commit: { message, author: { name: author, date: inWindow } },
    html_url: `https://github.com/acme/app/commit/${sha}`,
  };
}

describe('runGitHubRepoScan — multi-contributor ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ingests commits from every contributor in a private repo (3 authors → 3 rows)', async () => {
    routeFetch({
      repos: [
        {
          id: 1,
          full_name: 'acme/app',
          html_url: 'https://github.com/acme/app',
          pushed_at: inWindow,
        },
      ],
      commits: {
        'acme/app': [
          makeCommit('aaa111', 'Paperclip'),
          makeCommit('bbb222', 'Claude'),
          makeCommit('ccc333', 'broken_algorithms'),
        ],
      },
    });

    const { db, captured } = makeDb();

    const result = await runGitHubRepoScan({
      db: db as unknown as Parameters<typeof runGitHubRepoScan>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      accessToken: 'ghp_test',
      since: SINCE,
      until: UNTIL,
    });

    expect(result.reposScanned).toBe(1);
    expect(result.total).toBe(3);
    expect(result.ingested).toBe(3);
    expect(result.errors).toBe(0);

    // Each distinct author's commit produced its own row — the Events API would
    // only have surfaced the connecting user's own commits.
    const authors = captured.rows.map((r) => (r['metadata'] as { author: string }).author).sort();
    expect(authors).toEqual(['Claude', 'Paperclip', 'broken_algorithms']);
    expect(captured.rows.every((r) => r['eventType'] === 'commit_pushed')).toBe(true);
    // author_login is populated so the briefing groups by real contributor and
    // the feed `?author=` filter works for repo-scan rows (FUL-139).
    const authorLogins = captured.rows.map((r) => r['authorLogin']).sort();
    expect(authorLogins).toEqual(['Claude', 'Paperclip', 'broken_algorithms']);
  });

  it('ingests PRs by other contributors and classifies merged/open/closed', async () => {
    routeFetch({
      repos: [
        {
          id: 1,
          full_name: 'acme/app',
          html_url: 'https://github.com/acme/app',
          pushed_at: inWindow,
        },
      ],
      pulls: {
        'acme/app': [
          {
            id: 10,
            number: 1,
            title: 'Open one',
            html_url: 'https://github.com/acme/app/pull/1',
            state: 'open',
            merged_at: null,
            updated_at: inWindow,
            user: { login: 'Paperclip' },
            base: { ref: 'main' },
          },
          {
            id: 11,
            number: 2,
            title: 'Merged one',
            html_url: 'https://github.com/acme/app/pull/2',
            state: 'closed',
            merged_at: inWindow,
            updated_at: inWindow,
            user: { login: 'Claude' },
            base: { ref: 'main' },
          },
        ],
      },
    });

    const { db, captured } = makeDb();

    const result = await runGitHubRepoScan({
      db: db as unknown as Parameters<typeof runGitHubRepoScan>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      accessToken: 'ghp_test',
      since: SINCE,
      until: UNTIL,
    });

    expect(result.ingested).toBe(2);
    const byType = captured.rows.map((r) => r['eventType']).sort();
    expect(byType).toEqual(['pr_merged', 'pr_opened']);
  });

  it('respects the per-integration allowlist (FUL-82)', async () => {
    routeFetch({
      repos: [
        {
          id: 1,
          full_name: 'acme/app',
          html_url: 'https://github.com/acme/app',
          pushed_at: inWindow,
        },
        {
          id: 2,
          full_name: 'other/repo',
          html_url: 'https://github.com/other/repo',
          pushed_at: inWindow,
        },
      ],
      commits: {
        'acme/app': [makeCommit('aaa111', 'Paperclip')],
        'other/repo': [makeCommit('zzz999', 'Someone')],
      },
    });

    const { db, captured } = makeDb();

    const result = await runGitHubRepoScan({
      db: db as unknown as Parameters<typeof runGitHubRepoScan>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      accessToken: 'ghp_test',
      since: SINCE,
      until: UNTIL,
      config: { repoAllowlist: ['acme/app'] },
    });

    expect(result.reposScanned).toBe(1);
    expect(result.ingested).toBe(1);
    expect((captured.rows[0]!['metadata'] as { repo: string }).repo).toBe('acme/app');
  });

  it('skips repos pushed before the window', async () => {
    routeFetch({
      repos: [
        {
          id: 1,
          full_name: 'acme/app',
          html_url: 'https://github.com/acme/app',
          pushed_at: inWindow,
        },
        {
          id: 2,
          full_name: 'acme/stale',
          html_url: 'https://github.com/acme/stale',
          pushed_at: '2026-01-01T00:00:00Z',
        },
      ],
      commits: { 'acme/app': [makeCommit('aaa111', 'Paperclip')] },
    });

    const { db } = makeDb();

    const result = await runGitHubRepoScan({
      db: db as unknown as Parameters<typeof runGitHubRepoScan>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      accessToken: 'ghp_test',
      since: SINCE,
      until: UNTIL,
    });

    expect(result.reposScanned).toBe(1);
    expect(result.ingested).toBe(1);
  });

  it('isolates a per-repo fetch failure, counts it, and ingests the healthy repo', async () => {
    routeFetch({
      repos: [
        {
          id: 1,
          full_name: 'acme/bad',
          html_url: 'https://github.com/acme/bad',
          pushed_at: inWindow,
        },
        {
          id: 2,
          full_name: 'acme/good',
          html_url: 'https://github.com/acme/good',
          pushed_at: inWindow,
        },
      ],
      commits: { 'acme/good': [makeCommit('good111', 'Paperclip')] },
      commitError: ['acme/bad'],
    });

    const warn = vi.fn();
    const { db, captured } = makeDb();

    const result = await runGitHubRepoScan({
      db: db as unknown as Parameters<typeof runGitHubRepoScan>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      accessToken: 'ghp_test',
      since: SINCE,
      until: UNTIL,
      logger: { warn },
    });

    expect(result.errors).toBe(1);
    expect(result.lastError).toBeInstanceOf(Error);
    expect(result.ingested).toBe(1);
    expect((captured.rows[0]!['metadata'] as { repo: string }).repo).toBe('acme/good');
    expect(warn).toHaveBeenCalled();
  });

  it('throws when the top-level /user/repos fetch fails', async () => {
    mockFetch.mockImplementation(async () => jsonResponse(null, 500));

    const { db } = makeDb();

    await expect(
      runGitHubRepoScan({
        db: db as unknown as Parameters<typeof runGitHubRepoScan>[0]['db'],
        userId: 'user-1',
        integrationId: 'int-1',
        accessToken: 'ghp_test',
        since: SINCE,
        until: UNTIL,
      }),
    ).rejects.toThrow('GitHub API error: 500');
  });

  // FUL-98 regression: encodeURIComponent('owner/repo') -> 'owner%2Frepo', which
  // GitHub 404s (it does not decode %2F in a path). fetchAllPages then swallows
  // the 404 as a deleted repo and returns [], silently dropping every commit/PR
  // (the reposScanned:1 total:0 errors:0 blackout). The commit/PR request paths
  // must carry a literal slash between owner and repo.
  it('requests commits/PRs with a literal slash, never %2F (FUL-98)', async () => {
    routeFetch({
      repos: [
        {
          id: 1,
          full_name: 'cjthorpe/NiteOwl',
          html_url: 'https://github.com/cjthorpe/NiteOwl',
          pushed_at: inWindow,
        },
      ],
      commits: { 'cjthorpe/NiteOwl': [makeCommit('aaa111', 'Chris Thorpe')] },
    });

    const { db } = makeDb();

    const result = await runGitHubRepoScan({
      db: db as unknown as Parameters<typeof runGitHubRepoScan>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      accessToken: 'ghp_test',
      since: SINCE,
      until: UNTIL,
    });

    // The repo's commits are reachable, so they ingest (the bug returned 0).
    expect(result.ingested).toBe(1);

    const requestedUrls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(requestedUrls.some((u) => u.includes('/repos/cjthorpe/NiteOwl/commits'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/repos/cjthorpe/NiteOwl/pulls'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('%2F'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FUL-130 — pagination budgeting + backpressure for large orgs
// ---------------------------------------------------------------------------

/** Response builder that supports arbitrary headers (Link, rate-limit, …). */
function resp(body: unknown, opts: { status?: number; headers?: Record<string, string> } = {}) {
  const status = opts.status ?? 200;
  const headers = opts.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

function makePr(id: number, number: number, updatedAt: string) {
  return {
    id,
    number,
    title: `PR ${number}`,
    html_url: `https://github.com/acme/app/pull/${number}`,
    state: 'open' as const,
    merged_at: null,
    updated_at: updatedAt,
    user: { login: 'someone' },
    base: { ref: 'main' },
  };
}

const scanArgs = (db: unknown, extra: Record<string, unknown> = {}) => ({
  db: db as Parameters<typeof runGitHubRepoScan>[0]['db'],
  userId: 'user-1',
  integrationId: 'int-1',
  accessToken: 'ghp_test',
  since: SINCE,
  until: UNTIL,
  ...extra,
});

describe('RateBudget', () => {
  it('caps spending at maxRequests', () => {
    const budget = new RateBudget({ maxRequests: 2 });
    expect(budget.canSpend()).toBe(true);
    budget.spend();
    expect(budget.canSpend()).toBe(true);
    budget.spend();
    expect(budget.canSpend()).toBe(false);
    expect(budget.requestsUsed).toBe(2);
  });

  it('applies backpressure once GitHub reports remaining quota at/below the floor', () => {
    const budget = new RateBudget({ minRemaining: 100 });
    expect(budget.canSpend()).toBe(true);
    budget.observe(resp([], { headers: { 'x-ratelimit-remaining': '50' } }));
    expect(budget.canSpend()).toBe(false);
  });

  it('ignores a missing or non-numeric rate-limit header', () => {
    const budget = new RateBudget();
    budget.observe(resp([], {}));
    budget.observe(resp([], { headers: { 'x-ratelimit-remaining': 'nonsense' } }));
    expect(budget.canSpend()).toBe(true);
  });
});

describe('fetchAllPages — budgeting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('follows at most maxPages Link headers and flags the budget throttled', async () => {
    mockFetch.mockImplementation(async () =>
      resp([{ n: 1 }], { headers: { link: '<https://api.github.com/next>; rel="next"' } }),
    );
    const budget = new RateBudget();
    const items = await fetchAllPages<{ n: number }>('https://api.github.com/first', 'tok', {
      budget,
      maxPages: 2,
    });
    expect(items).toHaveLength(2); // one item per page, capped at 2 pages
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(budget.throttled).toBe(true);
  });

  it('stops early when stopWhen returns true, without following the next page', async () => {
    mockFetch.mockImplementation(async () =>
      resp([{ n: 1 }], { headers: { link: '<https://api.github.com/next>; rel="next"' } }),
    );
    const items = await fetchAllPages<{ n: number }>('https://api.github.com/first', 'tok', {
      stopWhen: () => true,
    });
    expect(items).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('runGitHubRepoScan — rate budgeting (FUL-130)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stops PR pagination once a page falls entirely before the window', async () => {
    const beforeWindow = '2026-06-20T00:00:00Z';
    const page2Url = 'https://api.github.com/repos/acme/app/pulls?page=2';

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/user/repos')) {
        return resp([{ id: 1, full_name: 'acme/app', html_url: 'https://x', pushed_at: inWindow }]);
      }
      if (url.includes('/commits')) return resp([]);
      if (url === page2Url) return resp([makePr(99, 99, beforeWindow)]); // must never run
      if (url.includes('/pulls')) {
        // Newest-first: one in-window PR, then one before the window → stop here.
        return resp([makePr(10, 1, inWindow), makePr(11, 2, beforeWindow)], {
          headers: { link: `<${page2Url}>; rel="next"` },
        });
      }
      return resp([]);
    });

    const { db } = makeDb();
    const result = await runGitHubRepoScan(scanArgs(db));

    expect(result.ingested).toBe(1); // only the in-window PR
    expect(result.rateLimited).toBe(false);
    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls).not.toContain(page2Url);
  });

  it('stops scanning further repos once the request cap is reached and reports the remainder', async () => {
    routeFetch({
      repos: [
        { id: 1, full_name: 'acme/a', html_url: 'https://x', pushed_at: inWindow },
        { id: 2, full_name: 'acme/b', html_url: 'https://x', pushed_at: inWindow },
        { id: 3, full_name: 'acme/c', html_url: 'https://x', pushed_at: inWindow },
      ],
      commits: { 'acme/a': [makeCommit('a1', 'Paperclip')] },
    });

    const { db } = makeDb();
    // Budget: /user/repos (1) + repo a commits (2) + repo a pulls (3) = cap hit.
    const result = await runGitHubRepoScan(scanArgs(db, { rateBudget: { maxRequests: 3 } }));

    expect(result.rateLimited).toBe(true);
    expect(result.reposScanned).toBe(1);
    expect(result.reposSkipped).toBe(2);
    expect(result.requestsUsed).toBe(3);
  });

  it('backs off before draining the quota when remaining drops below the floor', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/user/repos')) {
        return resp(
          [
            { id: 1, full_name: 'acme/a', html_url: 'https://x', pushed_at: inWindow },
            { id: 2, full_name: 'acme/b', html_url: 'https://x', pushed_at: inWindow },
          ],
          { headers: { 'x-ratelimit-remaining': '5000' } },
        );
      }
      // Every repo request reports a near-exhausted quota → backpressure engages.
      if (url.includes('/commits')) {
        return resp([makeCommit('a1', 'Paperclip')], {
          headers: { 'x-ratelimit-remaining': '50' },
        });
      }
      return resp([], { headers: { 'x-ratelimit-remaining': '50' } });
    });

    const warn = vi.fn();
    const { db } = makeDb();
    const result = await runGitHubRepoScan(scanArgs(db, { logger: { warn } }));

    expect(result.rateLimited).toBe(true);
    expect(result.reposScanned).toBeLessThan(2);
    expect(warn).toHaveBeenCalled();
  });
});

describe('encodeRepoPath', () => {
  it('preserves the owner/repo slash instead of encoding it to %2F', () => {
    expect(encodeRepoPath('cjthorpe/NiteOwl')).toBe('cjthorpe/NiteOwl');
  });

  it('still escapes unsafe characters within each segment', () => {
    // Repo names allow ., -, _ (left intact); a space would be escaped.
    expect(encodeRepoPath('acme/my repo')).toBe('acme/my%20repo');
    expect(encodeRepoPath('acme/repo.name-1_2')).toBe('acme/repo.name-1_2');
  });
});
