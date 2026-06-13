-- Migration: add author_login to activity_events (FUL-58)
-- Enables per-agent filtering on the feed API and morning-briefing attribution.
-- author_login is extracted from metadata at ingestion time so queries do not
-- require a JSON scan; the compound index supports the ?author= feed filter
-- efficiently when combined with the existing occurred_at ordering.
ALTER TABLE "activity_events"
  ADD COLUMN "author_login" text;

CREATE INDEX "activity_events_author_login_occurred_at_idx"
  ON "activity_events" ("author_login", "occurred_at" DESC);
