// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Per-event read/seen state DB operations (FUL-140).
 *
 * Read state lives in the thin `event_reads` join table — one row per
 * (user, event) the user has reviewed. These helpers are the only writers.
 *
 * Ownership guard (critical): a caller may only ever mark/unmark their *own*
 * events. Every write joins `activity_events` on the caller's `user_id`, so an
 * unknown or foreign `eventId` matches nothing and contributes 0 — it can never
 * create a read row for, or delete a read row belonging to, another user.
 *
 * Idempotency: marks use `ON CONFLICT (user_id, event_id) DO NOTHING`, so
 * re-marking an already-read event is a no-op. Each helper reports how many rows
 * actually changed (via `RETURNING`), so a repeat mark returns 0.
 */
import type { Db } from '@niteowl/db';
import { sql } from 'drizzle-orm';

/** Build a parameterised `(a, b, c)` UUID list for use in an `IN (...)` clause. */
function uuidList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/**
 * Mark the given events as read for `userId`. Only events the caller owns are
 * inserted; conflicts (already-read) are skipped. Returns the number of rows
 * newly inserted.
 */
export async function markEventsRead(
  db: Db,
  userId: string,
  eventIds: readonly string[],
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const rows = await db.execute(sql`
    insert into event_reads (user_id, event_id)
    select ${userId}::uuid, ae.id
    from activity_events ae
    where ae.user_id = ${userId}::uuid
      and ae.id in (${uuidList(eventIds)})
    on conflict (user_id, event_id) do nothing
    returning id
  `);
  return rows.length;
}

/**
 * Mark every event the caller owns as read (optionally only those at or before
 * `before`). Set-based `INSERT ... SELECT` keeps the write bounded server-side —
 * no event IDs are round-tripped through the app. Returns the number of rows
 * newly inserted (already-read events are skipped via `ON CONFLICT`).
 */
export async function markAllEventsRead(db: Db, userId: string, before?: Date): Promise<number> {
  const beforeClause = before ? sql`and ae.occurred_at <= ${before.toISOString()}` : sql``;
  const rows = await db.execute(sql`
    insert into event_reads (user_id, event_id)
    select ${userId}::uuid, ae.id
    from activity_events ae
    where ae.user_id = ${userId}::uuid
      ${beforeClause}
    on conflict (user_id, event_id) do nothing
    returning id
  `);
  return rows.length;
}

/**
 * Mark the given events as unread for `userId` by deleting their read rows.
 * Scoped to `event_reads.user_id = userId`, so a foreign eventId — which has no
 * read row for this caller — deletes nothing. Returns the number of rows removed.
 */
export async function unmarkEventsRead(
  db: Db,
  userId: string,
  eventIds: readonly string[],
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const rows = await db.execute(sql`
    delete from event_reads er
    using activity_events ae
    where er.event_id = ae.id
      and er.user_id = ${userId}::uuid
      and ae.user_id = ${userId}::uuid
      and er.event_id in (${uuidList(eventIds)})
    returning er.id
  `);
  return rows.length;
}
