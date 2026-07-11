# Data retention policy (FUL-132)

`activity_events` and `webhook_events` are append-only and, without intervention,
grow without bound. Left unchecked this degrades query performance and inflates
storage cost. A nightly retention sweep deletes rows older than a configurable
window.

## What is swept

| Table             | Keyed on      | Default window | Rationale                                                                                 |
| ----------------- | ------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `activity_events` | `ingested_at` | 180 days       | User-facing feed history; retained generously. Keyed on `ingested_at` (see below).        |
| `webhook_events`  | `received_at` | 30 days        | Pure idempotency/dedup ledger; only needs to outlive provider redelivery windows (hours). |

### Why `activity_events` is keyed on `ingested_at`, not `occurred_at`

Catch-up backfill (FUL-98 repo-scan, FUL-142 last-login windows) can ingest
events whose `occurred_at` is weeks in the past. If retention keyed on
`occurred_at`, a freshly-ingested backfill row could be deleted on the very next
sweep. Keying on `ingested_at` guarantees every row survives its full window from
the moment it landed — consistent with the ingestion-window semantics established
in FUL-142.

## How it runs

- A BullMQ repeating job (`event-retention` queue) fires daily at
  `RETENTION_HOUR_UTC:00` UTC (default **04:00**, deliberately offset from the
  06:00 overnight catch-up so the two nightly jobs don't contend).
- The scheduler is registered idempotently at startup via `upsertJobScheduler`,
  matching the overnight-catchup pattern.
- 3 attempts with a fixed 5-minute retry delay. Deletion is idempotent
  (already-deleted rows are simply not re-matched), so retries never over-delete.
- Deleted counts and cutoffs are logged at info level; a fully-disabled sweep is
  logged too, so "retention off" is observable rather than silently broken.

Implementation:

- `apps/api/src/lib/event-retention.ts` — pure sweep logic (`runEventRetention`,
  `resolveRetentionConfig`, `parseRetentionDays`).
- `apps/api/src/workers/retention.worker.ts` — BullMQ worker.
- `apps/api/src/plugins/queue.ts` — queue + daily scheduler registration.

## Configuration

| Env var                          | Default | Meaning                                                              |
| -------------------------------- | ------- | -------------------------------------------------------------------- |
| `ACTIVITY_EVENTS_RETENTION_DAYS` | `180`   | Days of feed history to keep. `0` disables the sweep for this table. |
| `WEBHOOK_EVENTS_RETENTION_DAYS`  | `30`    | Days of idempotency records to keep. `0` disables.                   |
| `RETENTION_HOUR_UTC`             | `4`     | UTC hour (0–23) the sweep fires.                                     |

Parsing fails **safe**: a negative or non-numeric value falls back to the default
rather than deleting everything. An explicit `0` is the only way to disable a
table's sweep.

## Supporting indexes

Migration `0010_event_retention_indexes.sql` adds:

- `activity_events_ingested_at_idx` on `activity_events(ingested_at)`
- `webhook_events_received_at_idx` on `webhook_events(received_at)`

so each nightly `DELETE ... WHERE <ts> < cutoff` range-scans the doomed rows
rather than seq-scanning the whole table. The `activity_events` index also serves
the `ingested_at` last-login windows introduced in FUL-142 (addressing the
FUL-143 index follow-up).

## Operational notes

- **First run after a long unbounded period** may delete a large batch. Postgres
  reclaims space lazily; run `VACUUM (ANALYZE)` (or rely on autovacuum) afterward
  if you need the disk back immediately. For very large first sweeps consider a
  one-off batched manual delete before enabling the nightly job.
- **Disabling retention** (`*_RETENTION_DAYS=0`) is intended for deployments that
  must retain everything (e.g. pending a compliance export). The indexes remain
  and are cheap to keep.
