// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, it, expect } from 'vitest';

import {
  parseRetentionDays,
  resolveRetentionConfig,
  runEventRetention,
  DEFAULT_ACTIVITY_EVENTS_RETENTION_DAYS,
  DEFAULT_WEBHOOK_EVENTS_RETENTION_DAYS,
  type RetentionConfig,
} from './event-retention.js';

// ---------------------------------------------------------------------------
// DB double
// ---------------------------------------------------------------------------

interface DeleteCall {
  table: unknown;
  whereArg: unknown;
}

/**
 * Records every delete(...).where(...).returning() chain and resolves each to a
 * caller-supplied row array so we can assert both the number of statements and
 * the reported delete counts.
 */
function makeDb(returningRows: Array<Array<{ id: string }>>) {
  const deleteCalls: DeleteCall[] = [];
  let call = 0;

  const db = {
    delete(table: unknown) {
      const rows = returningRows[call] ?? [];
      const record: DeleteCall = { table, whereArg: undefined };
      deleteCalls.push(record);
      call += 1;
      return {
        where(whereArg: unknown) {
          record.whereArg = whereArg;
          return {
            returning() {
              return Promise.resolve(rows);
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as Parameters<typeof runEventRetention>[0], deleteCalls };
}

// ---------------------------------------------------------------------------
// parseRetentionDays
// ---------------------------------------------------------------------------

describe('parseRetentionDays', () => {
  it('returns the fallback when unset or empty', () => {
    expect(parseRetentionDays(undefined, 180)).toBe(180);
    expect(parseRetentionDays('', 180)).toBe(180);
    expect(parseRetentionDays('   ', 180)).toBe(180);
  });

  it('treats an explicit 0 as disabled', () => {
    expect(parseRetentionDays('0', 180)).toBe(0);
  });

  it('accepts a positive integer', () => {
    expect(parseRetentionDays('45', 180)).toBe(45);
  });

  it('fails safe to the fallback on negative or non-numeric input', () => {
    expect(parseRetentionDays('-5', 180)).toBe(180);
    expect(parseRetentionDays('abc', 180)).toBe(180);
    expect(parseRetentionDays('12.5', 180)).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// resolveRetentionConfig
// ---------------------------------------------------------------------------

describe('resolveRetentionConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(resolveRetentionConfig({})).toEqual({
      activityEventsRetentionDays: DEFAULT_ACTIVITY_EVENTS_RETENTION_DAYS,
      webhookEventsRetentionDays: DEFAULT_WEBHOOK_EVENTS_RETENTION_DAYS,
    });
  });

  it('reads overrides from env', () => {
    expect(
      resolveRetentionConfig({
        ACTIVITY_EVENTS_RETENTION_DAYS: '90',
        WEBHOOK_EVENTS_RETENTION_DAYS: '0',
      }),
    ).toEqual({ activityEventsRetentionDays: 90, webhookEventsRetentionDays: 0 });
  });
});

// ---------------------------------------------------------------------------
// runEventRetention
// ---------------------------------------------------------------------------

describe('runEventRetention', () => {
  const now = new Date('2026-07-11T00:00:00.000Z');

  it('deletes from both tables and reports counts + cutoffs', async () => {
    const { db, deleteCalls } = makeDb([
      [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], // activity_events
      [{ id: 'w1' }], // webhook_events
    ]);

    const config: RetentionConfig = {
      activityEventsRetentionDays: 180,
      webhookEventsRetentionDays: 30,
    };

    const result = await runEventRetention(db, config, now);

    expect(deleteCalls).toHaveLength(2);
    expect(result.activityEventsDeleted).toBe(3);
    expect(result.webhookEventsDeleted).toBe(1);
    // 180 days before 2026-07-11 → 2026-01-12
    expect(result.activityCutoff).toEqual(new Date('2026-01-12T00:00:00.000Z'));
    // 30 days before 2026-07-11 → 2026-06-11
    expect(result.webhookCutoff).toEqual(new Date('2026-06-11T00:00:00.000Z'));
  });

  it('skips activity_events when its window is disabled (0)', async () => {
    const { db, deleteCalls } = makeDb([[{ id: 'w1' }, { id: 'w2' }]]);

    const result = await runEventRetention(
      db,
      { activityEventsRetentionDays: 0, webhookEventsRetentionDays: 30 },
      now,
    );

    // Only the webhook sweep issues a delete.
    expect(deleteCalls).toHaveLength(1);
    expect(result.activityEventsDeleted).toBe(0);
    expect(result.activityCutoff).toBeNull();
    expect(result.webhookEventsDeleted).toBe(2);
    expect(result.webhookCutoff).not.toBeNull();
  });

  it('deletes nothing when both windows are disabled', async () => {
    const { db, deleteCalls } = makeDb([]);

    const result = await runEventRetention(
      db,
      { activityEventsRetentionDays: 0, webhookEventsRetentionDays: 0 },
      now,
    );

    expect(deleteCalls).toHaveLength(0);
    expect(result).toEqual({
      activityEventsDeleted: 0,
      webhookEventsDeleted: 0,
      activityCutoff: null,
      webhookCutoff: null,
    });
  });

  it('uses a live clock when no `now` is injected', async () => {
    const { db } = makeDb([[], []]);
    const result = await runEventRetention(db, {
      activityEventsRetentionDays: 1,
      webhookEventsRetentionDays: 1,
    });
    // Both cutoffs should be roughly one day in the past — assert they are set
    // and ordered before the current instant rather than pinning an exact value.
    expect(result.activityCutoff).toBeInstanceOf(Date);
    expect(result.webhookCutoff).toBeInstanceOf(Date);
    expect(result.activityCutoff!.getTime()).toBeLessThan(Date.now());
  });
});
