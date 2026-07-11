// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Event retention policy (FUL-132).
 *
 * `activity_events` and `webhook_events` grow without bound: every ingested
 * feed item and every webhook idempotency record is written and never removed.
 * Left alone the tables degrade query performance and inflate storage cost.
 *
 * This module deletes rows older than a configurable window:
 *
 *  - `activity_events`   → keyed on `ingested_at` (NOT `occurred_at`). Retention
 *    must match the ingestion window semantics established in FUL-142: catch-up
 *    backfill can ingest events whose `occurred_at` is weeks old, and those must
 *    survive for their full retention window from the moment they landed. Keying
 *    on `ingested_at` guarantees a freshly-ingested backfill row is never deleted
 *    on the very next sweep.
 *  - `webhook_events`    → keyed on `received_at`. This is a pure idempotency /
 *    dedup ledger; entries are only useful while a provider might redeliver the
 *    same payload (hours, not weeks), so its default window is far shorter.
 *
 * A retention window of `0` (or a non-positive / unparseable value) disables the
 * sweep for that table — nothing is deleted. This is the escape hatch for
 * deployments that must retain everything (e.g. for compliance export) until a
 * window is explicitly chosen.
 */

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { lt } from 'drizzle-orm';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Feed history is user-facing, so it is retained generously by default. */
export const DEFAULT_ACTIVITY_EVENTS_RETENTION_DAYS = 180;
/** Idempotency ledger only needs to outlive provider redelivery windows. */
export const DEFAULT_WEBHOOK_EVENTS_RETENTION_DAYS = 30;

export interface RetentionConfig {
  /** Delete `activity_events` older than this many days. 0 = disabled. */
  activityEventsRetentionDays: number;
  /** Delete `webhook_events` older than this many days. 0 = disabled. */
  webhookEventsRetentionDays: number;
}

export interface RetentionResult {
  activityEventsDeleted: number;
  webhookEventsDeleted: number;
  /** null when the corresponding table's retention is disabled. */
  activityCutoff: Date | null;
  webhookCutoff: Date | null;
}

/**
 * Parses a retention-days value from an environment string.
 *
 * Rules:
 *  - unset / empty            → fall back to `fallback`
 *  - explicit `0`             → disabled (returns 0)
 *  - positive integer         → that many days
 *  - negative / non-numeric   → fall back to `fallback` (fail safe, never a
 *                               surprise "delete everything" from a typo)
 */
export function parseRetentionDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * Resolves the retention configuration from environment variables.
 *
 *  - `ACTIVITY_EVENTS_RETENTION_DAYS` (default 180)
 *  - `WEBHOOK_EVENTS_RETENTION_DAYS`  (default 30)
 */
export function resolveRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    activityEventsRetentionDays: parseRetentionDays(
      env['ACTIVITY_EVENTS_RETENTION_DAYS'],
      DEFAULT_ACTIVITY_EVENTS_RETENTION_DAYS,
    ),
    webhookEventsRetentionDays: parseRetentionDays(
      env['WEBHOOK_EVENTS_RETENTION_DAYS'],
      DEFAULT_WEBHOOK_EVENTS_RETENTION_DAYS,
    ),
  };
}

/**
 * Deletes expired rows from `activity_events` and `webhook_events`.
 *
 * Each table is swept independently — a disabled window (days <= 0) skips that
 * table entirely and leaves its cutoff null in the result. The two deletes are
 * ordinary statements against indexed timestamp columns
 * (`activity_events_ingested_at_idx`, `webhook_events_received_at_idx`), so the
 * planner can range-scan rather than seq-scan the tables.
 *
 * @param db     Drizzle client.
 * @param config Retention windows in days.
 * @param now    Injectable clock (defaults to wall-clock) — kept explicit so the
 *               caller / tests control the cutoff boundary deterministically.
 */
export async function runEventRetention(
  db: Db,
  config: RetentionConfig,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const result: RetentionResult = {
    activityEventsDeleted: 0,
    webhookEventsDeleted: 0,
    activityCutoff: null,
    webhookCutoff: null,
  };

  if (config.activityEventsRetentionDays > 0) {
    const cutoff = new Date(now.getTime() - config.activityEventsRetentionDays * DAY_MS);
    const deleted = await db
      .delete(schema.activityEvents)
      .where(lt(schema.activityEvents.ingestedAt, cutoff))
      .returning({ id: schema.activityEvents.id });
    result.activityCutoff = cutoff;
    result.activityEventsDeleted = deleted.length;
  }

  if (config.webhookEventsRetentionDays > 0) {
    const cutoff = new Date(now.getTime() - config.webhookEventsRetentionDays * DAY_MS);
    const deleted = await db
      .delete(schema.webhookEvents)
      .where(lt(schema.webhookEvents.receivedAt, cutoff))
      .returning({ id: schema.webhookEvents.id });
    result.webhookCutoff = cutoff;
    result.webhookEventsDeleted = deleted.length;
  }

  return result;
}
