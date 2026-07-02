// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Unit tests for the per-event read-state DB operations (FUL-140).
 *
 * These cover the query-issuing + count-derivation contract of the helpers
 * against a mock `db.execute`. The mock returns the rows Postgres would emit
 * from each `RETURNING` clause; the helpers derive their counts from `.length`,
 * so an empty result — e.g. a foreign eventId that the ownership join filters
 * out, or an idempotent re-mark that `ON CONFLICT DO NOTHING` swallows — yields
 * 0. The actual ownership/idempotency SQL semantics are exercised in Postgres;
 * here we pin the JS-side behaviour that turns a result set into a count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { markEventsRead, markAllEventsRead, unmarkEventsRead } from './read-state.js';

const USER_ID = 'b1234567-0000-0000-0000-000000000001';

interface MockDb {
  execute: ReturnType<typeof vi.fn>;
}

let db: MockDb;

beforeEach(() => {
  db = { execute: vi.fn() };
});

describe('markEventsRead', () => {
  it('returns 0 without touching the DB when eventIds is empty', async () => {
    const marked = await markEventsRead(db as never, USER_ID, []);
    expect(marked).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('marks owned events and returns the number of newly-inserted rows', async () => {
    db.execute.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }]);
    const marked = await markEventsRead(db as never, USER_ID, ['e1', 'e2', 'e3']);
    expect(marked).toBe(2);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second mark of the same events inserts nothing → 0', async () => {
    db.execute.mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING returned no rows
    const marked = await markEventsRead(db as never, USER_ID, ['e1']);
    expect(marked).toBe(0);
  });

  it('rejects foreign events: an unowned eventId contributes 0', async () => {
    db.execute.mockResolvedValueOnce([]); // ownership join filtered it out
    const marked = await markEventsRead(db as never, USER_ID, ['not-mine']);
    expect(marked).toBe(0);
  });
});

describe('markAllEventsRead', () => {
  it('marks every unread owned event and returns the count', async () => {
    db.execute.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);
    const marked = await markAllEventsRead(db as never, USER_ID);
    expect(marked).toBe(3);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('marks with a before cutoff and returns the count', async () => {
    db.execute.mockResolvedValueOnce([{ id: 'r1' }]);
    const before = new Date('2026-01-01T00:00:00.000Z');
    const marked = await markAllEventsRead(db as never, USER_ID, before);
    expect(marked).toBe(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when there is nothing left to mark', async () => {
    db.execute.mockResolvedValueOnce([]);
    const marked = await markAllEventsRead(db as never, USER_ID);
    expect(marked).toBe(0);
  });
});

describe('unmarkEventsRead', () => {
  it('returns 0 without touching the DB when eventIds is empty', async () => {
    const unmarked = await unmarkEventsRead(db as never, USER_ID, []);
    expect(unmarked).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('deletes matching read rows and returns the number removed', async () => {
    db.execute.mockResolvedValueOnce([{ id: 'r1' }]);
    const unmarked = await unmarkEventsRead(db as never, USER_ID, ['e1', 'e2']);
    expect(unmarked).toBe(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('never removes another user rows: no match → 0 unmarked', async () => {
    db.execute.mockResolvedValueOnce([]);
    const unmarked = await unmarkEventsRead(db as never, USER_ID, ['someone-elses-event']);
    expect(unmarked).toBe(0);
  });
});
