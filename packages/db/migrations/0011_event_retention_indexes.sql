-- Migration: event-retention supporting indexes (FUL-132)
-- The nightly retention sweep deletes expired rows keyed on a timestamp:
--   activity_events WHERE ingested_at < cutoff
--   webhook_events  WHERE received_at < cutoff
-- Without an index on those columns each sweep seq-scans the whole table — the
-- exact cost/perf degradation the retention policy exists to prevent. These
-- btree indexes let the planner range-scan the doomed rows. The activity_events
-- index additionally serves the ingested_at last-login windows from FUL-142.
CREATE INDEX IF NOT EXISTS "activity_events_ingested_at_idx" ON "activity_events" ("ingested_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_received_at_idx" ON "webhook_events" ("received_at");
