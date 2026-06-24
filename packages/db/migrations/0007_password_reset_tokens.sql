-- Migration: password_reset_tokens table (FUL-85)
-- Backs the self-service "forgot password" flow. Tokens are single-use and
-- short-lived (~30 min). The raw token is emailed to the user and never
-- persisted — only its SHA-256 fingerprint is stored, mirroring refresh_tokens.

CREATE TABLE "password_reset_tokens" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash"  text NOT NULL,
  "expires_at"  timestamptz NOT NULL,
  "used_at"     timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" ("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" ("user_id");
