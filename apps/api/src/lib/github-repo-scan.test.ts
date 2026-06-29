// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { encodeRepoPath, runGitHubRepoScan } from './github-repo-scan.js';

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
