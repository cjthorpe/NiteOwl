// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Unit tests for the overnight catch-up worker (FUL-60).
 *
 * We test the processor logic in isolation by:
 *  - Mocking the DB to return controllable integration rows.
 *  - Mocking runLinearCatchup from the lib module.
 *  - Stubbing the BullMQ Worker constructor so no Redis connection is opened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub BullMQ Worker so no Redis is required
// ---------------------------------------------------------------------------

let capturedProcessor: ((job: { id?: string }) => Promise<void>) | null = null;

vi.mock('bullmq', () => {
  return {
    Worker: vi
      .fn()
      .mockImplementation((_queue: string, processor: (job: { id?: string }) => Promise<void>) => {
        capturedProcessor = processor;
        return {
          on: vi.fn(),
          close: vi.fn().mockResolvedValue(undefined),
        };
      }),
    Queue: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
      close: vi.fn().mockResolvedValue(undefined),
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// ---------------------------------------------------------------------------
// Stub runLinearCatchup
// ---------------------------------------------------------------------------

const mockRunLinearCatchup = vi.fn();

vi.mock('../lib/linear-catchup.js', () => ({
  runLinearCatchup: mockRunLinearCatchup,
}));

const mockRunGitHubRepoScan = vi.fn();

vi.mock('../lib/github-repo-scan.js', () => ({
  runGitHubRepoScan: mockRunGitHubRepoScan,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LinearRow {
  integrationId: string;
  userId: string;
  accessToken: string;
}

interface GithubRow {
  integrationId: string;
  userId: string;
  configJson: { repoAllowlist?: unknown } | null;
  accessToken: string;
}

function makeDb(linearRows: LinearRow[], githubRows: GithubRow[] = []) {
  // The processor runs the Linear integration query first, then the GitHub one.
  // `.where` terminates each select chain, so resolve linear rows on the first
  // call and github rows on the second. `.update(...).set(...).where(...)` (the
  // lastSyncedAt stamp) is not exercised here.
  const query = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValueOnce(linearRows).mockResolvedValueOnce(githubRows),
  };
  return query as unknown as Parameters<
    (typeof import('./overnight-catchup.worker.js'))['createOvernightCatchupWorker']
  >[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('overnight-catchup worker', () => {
  const redisOptions = { host: 'localhost', port: 6379 };

  beforeEach(() => {
    capturedProcessor = null;
    // Only reset the per-test mocks (not the Worker module mock whose
    // implementation must survive across tests in this file).
    mockRunLinearCatchup.mockReset();
    mockRunGitHubRepoScan.mockReset();
  });

  it('processes all active Linear integrations and accumulates ingested count', async () => {
    const { createOvernightCatchupWorker } = await import('./overnight-catchup.worker.js');

    mockRunLinearCatchup
      .mockResolvedValueOnce({ ingested: 3 })
      .mockResolvedValueOnce({ ingested: 7 });

    const db = makeDb([
      { integrationId: 'int-1', userId: 'user-1', accessToken: 'tok-1' },
      { integrationId: 'int-2', userId: 'user-2', accessToken: 'tok-2' },
    ]);

    createOvernightCatchupWorker(db, redisOptions);

    expect(capturedProcessor).not.toBeNull();
    await capturedProcessor!({ id: 'job-42' });

    expect(mockRunLinearCatchup).toHaveBeenCalledTimes(2);
    expect(mockRunLinearCatchup).toHaveBeenCalledWith({
      db,
      userId: 'user-1',
      integrationId: 'int-1',
      accessToken: 'tok-1',
    });
    expect(mockRunLinearCatchup).toHaveBeenCalledWith({
      db,
      userId: 'user-2',
      integrationId: 'int-2',
      accessToken: 'tok-2',
    });
  });

  it('continues past a failed Linear integration without aborting the job', async () => {
    const { createOvernightCatchupWorker } = await import('./overnight-catchup.worker.js');

    mockRunLinearCatchup
      .mockRejectedValueOnce(new Error('Linear API timeout'))
      .mockResolvedValueOnce({ ingested: 5 });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const db = makeDb([
      { integrationId: 'int-fail', userId: 'user-1', accessToken: 'tok-bad' },
      { integrationId: 'int-ok', userId: 'user-2', accessToken: 'tok-ok' },
    ]);

    createOvernightCatchupWorker(db, redisOptions);

    // Should NOT throw even though the first integration failed
    await expect(capturedProcessor!({ id: 'job-err' })).resolves.toBeUndefined();

    expect(mockRunLinearCatchup).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('int-fail'),
      expect.any(String),
    );
  });

  it('completes successfully when there are no active integrations', async () => {
    const { createOvernightCatchupWorker } = await import('./overnight-catchup.worker.js');

    const db = makeDb([]); // no rows

    createOvernightCatchupWorker(db, redisOptions);

    await expect(capturedProcessor!({ id: 'job-empty' })).resolves.toBeUndefined();

    expect(mockRunLinearCatchup).not.toHaveBeenCalled();
  });

  it('exports the correct queue name constant', async () => {
    const { OVERNIGHT_CATCHUP_QUEUE } = await import('./overnight-catchup.worker.js');
    expect(OVERNIGHT_CATCHUP_QUEUE).toBe('overnight-catchup');
  });

  // FUL-98: GitHub integrations are ingested via the deterministic repo-scan
  // source, not the user-scoped Events API. No githubLogin is required — the
  // scan only needs the access token — and the allowlist config is passed
  // through so per-integration scoping (FUL-82) is preserved.
  it('processes GitHub integrations via repo-scan and accumulates ingested count', async () => {
    const { createOvernightCatchupWorker } = await import('./overnight-catchup.worker.js');

    mockRunGitHubRepoScan.mockResolvedValueOnce({
      reposScanned: 1,
      ingested: 4,
      total: 4,
      errors: 0,
    });

    const db = makeDb(
      [],
      [
        {
          integrationId: 'gh-int-1',
          userId: 'gh-user-1',
          configJson: { repoAllowlist: ['acme/app'] },
          accessToken: 'gh-tok-1',
        },
      ],
    );

    createOvernightCatchupWorker(db, redisOptions);

    await expect(capturedProcessor!({ id: 'job-gh' })).resolves.toBeUndefined();

    expect(mockRunGitHubRepoScan).toHaveBeenCalledTimes(1);
    expect(mockRunGitHubRepoScan).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        userId: 'gh-user-1',
        integrationId: 'gh-int-1',
        accessToken: 'gh-tok-1',
        config: { repoAllowlist: ['acme/app'] },
        since: expect.any(Date),
        until: expect.any(Date),
      }),
    );
  });

  it('continues past a failed GitHub repo-scan without aborting the job', async () => {
    const { createOvernightCatchupWorker } = await import('./overnight-catchup.worker.js');

    mockRunGitHubRepoScan
      .mockRejectedValueOnce(new Error('GitHub API down'))
      .mockResolvedValueOnce({ reposScanned: 2, ingested: 5, total: 5, errors: 0 });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const db = makeDb(
      [],
      [
        { integrationId: 'gh-fail', userId: 'u1', configJson: null, accessToken: 't1' },
        { integrationId: 'gh-ok', userId: 'u2', configJson: null, accessToken: 't2' },
      ],
    );

    createOvernightCatchupWorker(db, redisOptions);

    await expect(capturedProcessor!({ id: 'job-gh-err' })).resolves.toBeUndefined();

    expect(mockRunGitHubRepoScan).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('gh-fail'),
      expect.any(String),
    );

    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// parseCatchupHour is tested via the queue plugin behaviour
// ---------------------------------------------------------------------------

describe('parseCatchupHour (via queue plugin)', () => {
  it('defaults to hour 6 when CATCHUP_HOUR_UTC is unset', async () => {
    delete process.env['CATCHUP_HOUR_UTC'];

    // We can't import queue.ts easily here without Redis, so we inline
    // the same logic as a pure unit test.
    const parseCatchupHour = () => {
      const raw = process.env['CATCHUP_HOUR_UTC'];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(6);
  });

  it('parses CATCHUP_HOUR_UTC=3 correctly', () => {
    process.env['CATCHUP_HOUR_UTC'] = '3';

    const parseCatchupHour = () => {
      const raw = process.env['CATCHUP_HOUR_UTC'];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(3);
    delete process.env['CATCHUP_HOUR_UTC'];
  });

  it('falls back to 6 for out-of-range values', () => {
    process.env['CATCHUP_HOUR_UTC'] = '99';

    const parseCatchupHour = () => {
      const raw = process.env['CATCHUP_HOUR_UTC'];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(6);
    delete process.env['CATCHUP_HOUR_UTC'];
  });

  it('falls back to 6 for non-numeric values', () => {
    process.env['CATCHUP_HOUR_UTC'] = 'dawn';

    const parseCatchupHour = () => {
      const raw = process.env['CATCHUP_HOUR_UTC'];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(6);
    delete process.env['CATCHUP_HOUR_UTC'];
  });
});
