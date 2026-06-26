-- Migration: personal_access_tokens table (FUL-91)
-- Opaque, DB-backed Personal Access Tokens (PATs) so OAuth-only users (who have
-- no password) can mint a revocable Bearer token for headless/CLI/curl use.
-- The raw token is shown once at creation and never persisted — only its
-- SHA-256 fingerprint is stored, mirroring refresh_tokens / password_reset_tokens.
-- The raw token carries a `niteowl_pat_` prefix so the auth plugin can cheaply
-- distinguish a PAT from a JWT before any DB lookup.

CREATE TABLE "personal_access_tokens" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "token_hash"    text NOT NULL,
  "scopes"        text,
  "last_used_at"  timestamptz,
  "expires_at"    timestamptz,
  "revoked_at"    timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

-- token_hash is the sole lookup key on every authenticated request — UNIQUE
-- enforces at-most-once and backs the lookup index.
ALTER TABLE "personal_access_tokens"
  ADD CONSTRAINT "personal_access_tokens_token_hash_uniq" UNIQUE ("token_hash");
CREATE INDEX "personal_access_tokens_user_id_idx" ON "personal_access_tokens" ("user_id");
