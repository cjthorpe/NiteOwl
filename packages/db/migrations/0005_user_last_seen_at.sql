-- Migration: add last_seen_at to users (FUL-63)
-- Tracks the timestamp of the most recent session start per user.
-- Null until the user logs in for the first time after this migration.
-- Snapshotted into the JWT at login so the feed ?since=last_login window
-- stays stable for the entire session (prevents collapse-to-zero on refresh).
ALTER TABLE "users"
  ADD COLUMN "last_seen_at" timestamp with time zone;
