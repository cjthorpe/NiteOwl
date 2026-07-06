// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { createDb } from '@niteowl/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { register, reportIngestionRun } from './lib/metrics.js';

// A minimal DB stub that satisfies only the `/metrics` lag query
// (`select({ max }).from(activity_events)`); no other route is exercised.
function stubDb(maxIngestedAt: string | null): ReturnType<typeof createDb> {
  return {
    select: () => ({ from: () => Promise.resolve([{ max: maxIngestedAt }]) }),
  } as unknown as ReturnType<typeof createDb>;
}

describe('GET /metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('exposes the ingestion series in Prometheus text format', async () => {
    const app = buildApp({ db: stubDb(new Date(Date.now() - 30_000).toISOString()) });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    // All four counters, the histogram, and both gauges must be registered.
    for (const series of [
      'ingestion_fetched_total',
      'ingestion_inserted_total',
      'ingestion_errors_total',
      'ingestion_silent_failures_total',
      'ingestion_run_duration_seconds',
      'ingestion_queue_depth',
      'ingestion_lag_seconds',
    ]) {
      expect(res.body).toContain(series);
    }
  });

  it('reflects a recorded silent failure in the scrape output', async () => {
    // A blackout run with no webhook configured still bumps the counter.
    await reportIngestionRun(
      { provider: 'github', source: 'repo_scan', fetched: 405, inserted: 0 },
      { webhookUrl: undefined },
    );

    const app = buildApp({ db: stubDb(null) });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.body).toMatch(
      /ingestion_silent_failures_total\{provider="github",source="repo_scan"\} 1/,
    );
  });

  it('samples ingestion_lag_seconds from the most-recent ingested_at', async () => {
    const app = buildApp({ db: stubDb(new Date(Date.now() - 60_000).toISOString()) });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    const match = res.body.match(/^ingestion_lag_seconds (\d+(?:\.\d+)?)/m);
    expect(match).not.toBeNull();
    // ~60s ago; allow generous slack for test execution time.
    expect(Number(match![1])).toBeGreaterThanOrEqual(59);
  });
});
