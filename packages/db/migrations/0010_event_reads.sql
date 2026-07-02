-- Migration: per-event read/seen state (FUL-140)
-- Adds a thin `event_reads` join table recording that a user has reviewed a
-- given activity event. An event is "read" for a user iff a matching row exists.
--
-- This is orthogonal to the account-level `users.last_seen_at` watermark: the
-- watermark answers "what happened while I was away", these rows answer "which
-- of those have I actually reviewed". They compose; the watermark stays.
--
-- The UNIQUE(user_id, event_id) constraint makes mark-read idempotent at the DB
-- layer (ON CONFLICT DO NOTHING). The index on user_id backs unread counts and
-- existence joins from the feed query. Both foreign keys cascade on delete so
-- read rows are cleaned up when a user or event is removed.
CREATE TABLE "event_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_reads_user_id_event_id_uniq" UNIQUE("user_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "event_reads" ADD CONSTRAINT "event_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reads" ADD CONSTRAINT "event_reads_event_id_activity_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."activity_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_reads_user_id_idx" ON "event_reads" USING btree ("user_id");
