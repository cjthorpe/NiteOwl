<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2026 Fullstack Forge
-->

# Dead-letter handling & alerting for BullMQ (FUL-131)

## Problem

Every NiteOwl background job runs on BullMQ with a retry policy (`attempts` +
`backoff`). When a job exhausts its retries BullMQ moves it to the queue's
**failed set** and stops touching it. Until FUL-131 nothing observed that
transition: each worker's `failed` listener logged _every_ attempt (including
transient ones that would be retried), but an exhausted job just accumulated in
the failed set and vanished from operational view. A repeatedly-failing
normalization or Slack-alert job could silently drop user-visible activity.

## Approach: the failed set _is_ the dead-letter queue

We deliberately do **not** stand up a separate physical DLQ queue and shovel
jobs into it. BullMQ's failed set already provides everything a DLQ needs:

- **Durable retention** — bounded per queue by `removeOnFail: { count: N }`
  (normalization 5 000, slack-alert 1 000, overnight-catchup 90).
- **Inspection & re-drive** — via `queue.getFailed()`, `job.retry()`, or the
  bundled **Bull Board** dashboard (`@bull-board/fastify`).

What was missing was **visibility**, so FUL-131 adds exactly that.

## What was added

`apps/api/src/lib/dead-letter.ts`:

- **`isExhausted(job)`** — predicate: `attemptsMade >= (opts.attempts ?? 1)`.
  Distinguishes a final failure from a retryable one.
- **`reportDeadLetter(input, deps?)`** — bumps the `bullmq_dead_letter_total`
  counter and fires a Slack alert. Mirrors `reportIngestionRun` (FUL-145):
  gated on `SLACK_ALERT_WEBHOOK_URL`, and Slack delivery failures are swallowed
  and logged so alerting can never crash a worker.
- **`attachDeadLetterHandler(worker, queue)`** — registers a `failed` listener
  that reports **only exhausted jobs**, so the alert fires exactly once per job
  at exhaustion (not once per retry). It composes with each worker's existing
  per-attempt logging listener.

Wired into all three workers: `normalization`, `slack-alert`, and
`overnight-catchup`.

## Observability

| Signal | Where | Meaning |
| --- | --- | --- |
| `bullmq_dead_letter_total{queue}` | `/metrics` (Prometheus) | Rate/count of jobs that exhausted every retry. |
| `ingestion_queue_depth{queue,state="failed"}` | `/metrics` | Current depth of each queue's failed (dead-letter) set. |
| `☠️ Job dead-lettered — <queue>` Slack message | `SLACK_ALERT_WEBHOOK_URL` | Human-facing alert with job name/id, attempts, and the final error. |

Suggested alerting rule: page when `increase(bullmq_dead_letter_total[15m]) > 0`
or when `ingestion_queue_depth{state="failed"}` climbs without draining.

## Re-driving a dead letter

1. Open Bull Board (or call `queue.getFailed()`).
2. Inspect `failedReason` / stack to confirm the cause is resolved.
3. `job.retry()` (Bull Board's "Retry" button) to re-enqueue.

The dead-letter alert is an **ops** signal delivered to the shared
`SLACK_ALERT_WEBHOOK_URL`; it is independent of the per-user PR-merge webhooks
the slack-alert worker delivers, so a dead-lettered slack-alert job cannot loop.
