// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Ingestion observability metrics (FUL-145).
 *
 * Makes the FUL-98 silent-failure class (`fetched>0 inserted==0`) impossible to
 * miss: every ingestion run reports its fetched/inserted/error counts here, a
 * blackout bumps a dedicated counter AND fires a Slack alert, and the whole set
 * is exposed at `/metrics` in Prometheus text format.
 *
 * This module has NO Fastify dependency — it mirrors `slack-alert.ts` so it can
 * be called from the BullMQ workers, HTTP route handlers, and the post-login
 * backfill alike.
 *
 * Full OpenTelemetry export is deliberately deferred (it needs a collector); the
 * lightweight `timeSpan` helper records the run-duration histogram and emits a
 * structured `{traceId, span, provider, durationMs}` log instead.
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

import {
  formatSilentIngestionAlert,
  sendSlackAlert,
  type SilentIngestionAlertData,
} from './slack-alert.js';

// ---------------------------------------------------------------------------
// Label domains
// ---------------------------------------------------------------------------

/** Upstream provider an ingestion run pulled from. */
export type IngestionProvider = 'github' | 'linear' | 'jira';

/** Which ingestion path produced the run. */
export type IngestionSource = 'repo_scan' | 'catchup' | 'briefing' | 'post_login';

// ---------------------------------------------------------------------------
// Registry + metric definitions
// ---------------------------------------------------------------------------

/**
 * A dedicated registry (not the global default) so tests can construct isolated
 * state and the `/metrics` endpoint serialises exactly the ingestion series.
 */
export const register = new Registry();

const LABELS = ['provider', 'source'] as const;

export const ingestionFetchedTotal = new Counter({
  name: 'ingestion_fetched_total',
  help: 'Items fetched from the upstream provider per ingestion run.',
  labelNames: LABELS,
  registers: [register],
});

export const ingestionInsertedTotal = new Counter({
  name: 'ingestion_inserted_total',
  help: 'Rows newly inserted (ON CONFLICT duplicates excluded) per ingestion run.',
  labelNames: LABELS,
  registers: [register],
});

export const ingestionErrorsTotal = new Counter({
  name: 'ingestion_errors_total',
  help: 'Per-run ingestion errors (e.g. per-repo fetch failures that were skipped).',
  labelNames: LABELS,
  registers: [register],
});

export const ingestionSilentFailuresTotal = new Counter({
  name: 'ingestion_silent_failures_total',
  help: 'Runs where items were fetched but nothing was inserted (the FUL-98 class).',
  labelNames: LABELS,
  registers: [register],
});

export const ingestionRunDurationSeconds = new Histogram({
  name: 'ingestion_run_duration_seconds',
  help: 'Wall-clock duration of an ingestion span in seconds.',
  labelNames: LABELS,
  // Ingestion spans range from sub-second (empty windows) to tens of seconds
  // (busy repo scans). Buckets span that range for useful quantiles.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

export const ingestionQueueDepth = new Gauge({
  name: 'ingestion_queue_depth',
  help: 'Sampled BullMQ job counts for an ingestion queue, by job state.',
  labelNames: ['queue', 'state'],
  registers: [register],
});

export const ingestionLagSeconds = new Gauge({
  name: 'ingestion_lag_seconds',
  help: 'Seconds since the most recently ingested activity event (freshness).',
  registers: [register],
});

export const bullmqDeadLetterTotal = new Counter({
  name: 'bullmq_dead_letter_total',
  help: 'BullMQ jobs that exhausted every retry and were dead-lettered, by queue (FUL-131).',
  labelNames: ['queue'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Silent-failure boundary
// ---------------------------------------------------------------------------

/**
 * The FUL-98 silent-failure predicate: the provider returned work but none of it
 * landed in the database. `fetched=0` (genuinely nothing to do) and
 * `inserted>0` (at least some rows persisted) are NOT silent failures.
 */
export function isSilentFailure(fetched: number, inserted: number): boolean {
  return fetched > 0 && inserted === 0;
}

// ---------------------------------------------------------------------------
// Run reporting (counters + silent-failure alert)
// ---------------------------------------------------------------------------

export interface IngestionRunReport {
  provider: IngestionProvider;
  source: IngestionSource;
  /** Items pulled from upstream (repo-scan `total`, catch-up fetched, …). */
  fetched: number;
  /** Rows actually inserted (repo-scan/catch-up `ingested`). */
  inserted: number;
  /** Per-run errors that were isolated and skipped. Defaults to 0. */
  errors?: number;
  /** Correlates this run with its span logs. */
  traceId?: string;
}

export interface IngestionRunOutcome {
  silentFailure: boolean;
  /** True when a Slack alert was actually dispatched. */
  alertSent: boolean;
}

/**
 * Records the counters for a completed ingestion run and, when the run is a
 * silent failure, bumps `ingestion_silent_failures_total` and fires a Slack
 * alert.
 *
 * The alert is gated on `SLACK_ALERT_WEBHOOK_URL`: when the webhook is unset the
 * function no-ops cleanly (metrics still update). Slack delivery failures are
 * swallowed and logged — observability must never break the ingestion path.
 */
export async function reportIngestionRun(
  report: IngestionRunReport,
  deps: {
    webhookUrl?: string | undefined;
    now?: () => Date;
    logger?: SpanLogger;
    /** Injectable for tests; defaults to the real Slack sender. */
    send?: typeof sendSlackAlert;
  } = {},
): Promise<IngestionRunOutcome> {
  const { provider, source, fetched, inserted, errors = 0, traceId } = report;
  const labels = { provider, source };

  if (fetched > 0) ingestionFetchedTotal.inc(labels, fetched);
  if (inserted > 0) ingestionInsertedTotal.inc(labels, inserted);
  if (errors > 0) ingestionErrorsTotal.inc(labels, errors);

  if (!isSilentFailure(fetched, inserted)) {
    return { silentFailure: false, alertSent: false };
  }

  ingestionSilentFailuresTotal.inc(labels, 1);

  const webhookUrl = deps.webhookUrl ?? process.env['SLACK_ALERT_WEBHOOK_URL'];
  if (!webhookUrl) {
    return { silentFailure: true, alertSent: false };
  }

  const occurredAt = (deps.now?.() ?? new Date()).toISOString();
  const alert: SilentIngestionAlertData = {
    provider,
    source,
    fetched,
    inserted,
    occurredAt,
    ...(traceId !== undefined ? { traceId } : {}),
  };

  try {
    const send = deps.send ?? sendSlackAlert;
    await send(webhookUrl, formatSilentIngestionAlert(alert));
    return { silentFailure: true, alertSent: true };
  } catch (err) {
    deps.logger?.info(
      { traceId, provider, source, err: err instanceof Error ? err.message : String(err) },
      '[metrics] silent-ingestion Slack alert delivery failed',
    );
    return { silentFailure: true, alertSent: false };
  }
}

// ---------------------------------------------------------------------------
// Lightweight tracing / timing
// ---------------------------------------------------------------------------

/** Minimal structured logger surface (pino `request.log` or `console`-shim). */
export interface SpanLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface TimeSpanOptions {
  /** Human span name, e.g. `github.repo_scan`. */
  name: string;
  provider: IngestionProvider;
  source: IngestionSource;
  /** Per-run correlation id threaded through the worker. */
  traceId?: string;
  logger?: SpanLogger;
  /** Injectable clock (ms). Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Times `fn`, records the run into `ingestion_run_duration_seconds`, and emits a
 * structured span log. The histogram is recorded even when `fn` throws, so a
 * failing run still contributes latency data before the error propagates.
 */
export async function timeSpan<T>(opts: TimeSpanOptions, fn: () => Promise<T>): Promise<T> {
  const clock = opts.now ?? Date.now;
  const start = clock();
  let ok = true;
  try {
    return await fn();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    const durationMs = clock() - start;
    ingestionRunDurationSeconds.observe(
      { provider: opts.provider, source: opts.source },
      durationMs / 1000,
    );
    opts.logger?.info(
      {
        traceId: opts.traceId,
        span: opts.name,
        provider: opts.provider,
        source: opts.source,
        durationMs,
        ok,
      },
      `[span] ${opts.name} ${durationMs}ms`,
    );
  }
}

// ---------------------------------------------------------------------------
// Scrape-time samplers (called from the /metrics handler)
// ---------------------------------------------------------------------------

/** BullMQ `getJobCounts()` result subset we surface as queue-depth gauges. */
export type JobCounts = Record<string, number>;

/** Records a queue's sampled job counts into `ingestion_queue_depth`. */
export function setQueueDepth(queue: string, counts: JobCounts): void {
  for (const [state, value] of Object.entries(counts)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      ingestionQueueDepth.set({ queue, state }, value);
    }
  }
}

/**
 * Sets `ingestion_lag_seconds` from the most-recent `ingested_at`. A `null`
 * timestamp (no events yet) resets the gauge to 0 rather than emitting a
 * misleading epoch-sized lag.
 */
export function setIngestionLag(lastIngestedAt: Date | null, now: () => number = Date.now): void {
  if (!lastIngestedAt) {
    ingestionLagSeconds.set(0);
    return;
  }
  const lagMs = now() - lastIngestedAt.getTime();
  ingestionLagSeconds.set(Math.max(0, lagMs / 1000));
}
