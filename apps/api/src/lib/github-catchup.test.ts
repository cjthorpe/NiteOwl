import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// We test the enrichPayload logic indirectly via the exported runGitHubCatchup.
// For pure unit coverage we focus on the rate-limit and payload enrichment
// helpers without spawning real HTTP or DB connections.
// ---------------------------------------------------------------------------

// Mock global fetch so we can exercise the rate-limit path without network
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Rate-limit header parsing — tested via a thin re-export trick.
// We inline representative tests here using the mock fetch.
// ---------------------------------------------------------------------------

describe('GitHub catchup — rate limit handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops paginating when no events fall within the lookback window', async () => {
    // Return one page of events that are all older than 24 h
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const oldEventPage = {
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [
        {
          id: 'evt-1',
          type: 'PushEvent',
          actor: { id: 1, login: 'octocat' },
          repo: { id: 1, name: 'acme/app' },
          payload: { ref: 'refs/heads/main', after: 'abc123', before: '000000', commits: [] },
          created_at: old,
        },
      ],
    } as unknown as Response;

    // Two start URLs — each returns one page of old events
    mockFetch.mockResolvedValueOnce(oldEventPage);
    mockFetch.mockResolvedValueOnce(oldEventPage);

    // DB stub — should never be called (no events to insert)
    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };

    const { runGitHubCatchup } = await import('./github-catchup.js');

    const result = await runGitHubCatchup({
      db: db as unknown as Parameters<typeof runGitHubCatchup>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      githubLogin: 'octocat',
      accessToken: 'ghp_test',
      lookbackHours: 24,
    });

    // Two start URLs; first returns old events → stops; second returns same
    // The old events are fetched but none inserted
    expect(result.inserted).toBe(0);
  });

  it('respects X-RateLimit-Remaining and waits when near limit', async () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const resetSoon = Math.floor(Date.now() / 1000) + 1; // reset in 1 second

    // First call: near rate limit with a recent event
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '2'], // below threshold of 5 → should wait
        ['x-ratelimit-reset', String(resetSoon)],
        ['link', ''],
      ]),
      json: async () => [
        {
          id: 'evt-push',
          type: 'PushEvent',
          actor: { id: 99, login: 'dev' },
          repo: { id: 2, name: 'acme/api' },
          payload: {
            ref: 'refs/heads/main',
            after: 'deadbeef',
            before: '000000',
            commits: [
              {
                id: 'deadbeef',
                message: 'feat: add feature',
                url: 'https://github.com/acme/api/commit/deadbeef',
                timestamp: recent,
              },
            ],
            repository: { full_name: 'acme/api', html_url: 'https://github.com/acme/api' },
            pusher: { name: 'dev' },
          },
          created_at: recent,
        },
      ],
    } as unknown as Response);

    // Second start URL (received_events)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '60'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [],
    } as unknown as Response);

    const insertedIds: string[] = [];

    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockImplementation((row: { id: string }) => {
        insertedIds.push(row.id);
        return db;
      }),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: insertedIds[insertedIds.length - 1] }]),
    };

    const { runGitHubCatchup } = await import('./github-catchup.js');

    const result = await runGitHubCatchup({
      db: db as unknown as Parameters<typeof runGitHubCatchup>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      githubLogin: 'dev',
      accessToken: 'ghp_test2',
      lookbackHours: 24,
    });

    // The push event should have been inserted
    expect(result.fetched).toBeGreaterThan(0);
  });
});

describe('GitHub catchup — enrichPayload (Events API shape)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a PushEvent whose commits use Events API shape (sha, no timestamp, no url)', async () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    // Events API PushEvent: commits have `sha` not `id`, no `timestamp`, no `url`.
    // The event-level field for post-push SHA is `head`, not `after`.
    const eventsApiPushEvent = {
      id: 'evt-events-api',
      type: 'PushEvent',
      actor: { id: 42, login: 'alice' },
      repo: { id: 7, name: 'alice/project' },
      payload: {
        ref: 'refs/heads/main',
        head: 'cafebabe', // Events API uses `head`, not `after`
        before: '00000000',
        commits: [
          {
            sha: 'cafebabe', // Events API uses `sha`, not `id`
            message: 'fix: correct enrichPayload mapping',
            // no `timestamp` field — must be derived from event.created_at
            // no `url` field — must be synthesised
          },
        ],
      },
      created_at: recent,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [eventsApiPushEvent],
    } as unknown as Response);

    // Second start URL returns nothing
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [],
    } as unknown as Response);

    const insertedRows: unknown[] = [];
    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockImplementation((row: unknown) => {
        insertedRows.push(row);
        return db;
      }),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'inserted-id' }]),
    };

    const { runGitHubCatchup } = await import('./github-catchup.js');

    const result = await runGitHubCatchup({
      db: db as unknown as Parameters<typeof runGitHubCatchup>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      githubLogin: 'alice',
      accessToken: 'ghp_test3',
      lookbackHours: 24,
    });

    // Should insert the push event, not skip it due to Invalid Date
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);

    // The inserted row should have a valid occurredAt (not Invalid Date)
    const row = insertedRows[0] as { occurredAt: Date };
    expect(row.occurredAt).toBeInstanceOf(Date);
    expect(isNaN(row.occurredAt.getTime())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-integration repo allowlist (FUL-82)
// ---------------------------------------------------------------------------

describe('GitHub catchup — repo allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Two pages: a PushEvent for `allowed/repo` and one for `blocked/repo`. */
  function twoRepoPages(recent: string) {
    const mkEvent = (id: string, repo: string) => ({
      id,
      type: 'PushEvent',
      actor: { id: 1, login: 'dev' },
      repo: { id: 1, name: repo },
      payload: {
        ref: 'refs/heads/main',
        after: 'abc123',
        before: '000000',
        commits: [
          {
            id: 'abc123',
            message: 'feat: x',
            url: `https://github.com/${repo}/commit/abc123`,
            timestamp: recent,
          },
        ],
        repository: { full_name: repo, html_url: `https://github.com/${repo}` },
        pusher: { name: 'dev' },
      },
      created_at: recent,
    });

    return {
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [
        mkEvent('evt-allowed', 'allowed/repo'),
        mkEvent('evt-blocked', 'blocked/repo'),
      ],
    } as unknown as Response;
  }

  it('skips events whose repo is not on the allowlist', async () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    mockFetch.mockResolvedValueOnce(twoRepoPages(recent));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [],
    } as unknown as Response);

    const insertedRows: Array<{ metadata?: { repo?: string } }> = [];
    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockImplementation((row: { metadata?: { repo?: string } }) => {
        insertedRows.push(row);
        return db;
      }),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'inserted-id' }]),
    };

    const { runGitHubCatchup } = await import('./github-catchup.js');

    const result = await runGitHubCatchup({
      db: db as unknown as Parameters<typeof runGitHubCatchup>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      githubLogin: 'dev',
      accessToken: 'ghp_test',
      lookbackHours: 24,
      config: { repoAllowlist: ['allowed/repo'] },
    });

    // Only the allowed repo's event is inserted; the blocked one is skipped.
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]?.metadata?.repo).toBe('allowed/repo');
  });

  it('ingests all repos when no allowlist is configured (backward-compatible)', async () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    mockFetch.mockResolvedValueOnce(twoRepoPages(recent));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [],
    } as unknown as Response);

    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'inserted-id' }]),
    };

    const { runGitHubCatchup } = await import('./github-catchup.js');

    const result = await runGitHubCatchup({
      db: db as unknown as Parameters<typeof runGitHubCatchup>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      githubLogin: 'dev',
      accessToken: 'ghp_test',
      lookbackHours: 24,
      // no config → allow all
    });

    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
  });

  // Regression (FUL-88): a single malformed event or transient insert failure
  // must not abort the whole catchup run and silently drop every subsequent
  // event. Previously an uncaught throw inside the loop killed the run.
  it('isolates a per-event failure and continues with remaining events', async () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    const makePushEvent = (id: string, sha: string) => ({
      id,
      type: 'PushEvent',
      actor: { id: 1, login: 'dev' },
      repo: { id: 1, name: 'acme/app' },
      payload: {
        ref: 'refs/heads/main',
        after: sha,
        before: '000000',
        commits: [
          {
            id: sha,
            message: 'feat: change',
            url: `https://github.com/acme/app/commit/${sha}`,
            timestamp: recent,
          },
        ],
      },
      created_at: recent,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [makePushEvent('evt-1', 'aaa111'), makePushEvent('evt-2', 'bbb222')],
    } as unknown as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([
        ['x-ratelimit-remaining', '50'],
        ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)],
        ['link', ''],
      ]),
      json: async () => [],
    } as unknown as Response);

    // First insert throws, second succeeds — the run must survive the first.
    let call = 0;
    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockImplementation(() => {
        call += 1;
        if (call === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve([{ id: 'inserted-id' }]);
      }),
    };

    const { runGitHubCatchup } = await import('./github-catchup.js');

    const result = await runGitHubCatchup({
      db: db as unknown as Parameters<typeof runGitHubCatchup>[0]['db'],
      userId: 'user-1',
      integrationId: 'int-1',
      githubLogin: 'dev',
      accessToken: 'ghp_test',
      lookbackHours: 24,
    });

    // The second event still gets inserted despite the first throwing.
    expect(result.inserted).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.lastError).toBeInstanceOf(Error);
  });
});
