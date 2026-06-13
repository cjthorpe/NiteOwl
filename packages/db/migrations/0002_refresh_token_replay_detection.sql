-- Migration: add rotated_at to refresh_tokens for replay detection (FUL-52)
-- Soft-delete on rotation: mark used tokens instead of hard-deleting them so
-- that a re-presented (stolen) token can be distinguished from a never-issued
-- or naturally-expired token, triggering full-session revocation.
ALTER TABLE "refresh_tokens"
  ADD COLUMN "rotated_at" timestamp with time zone;
