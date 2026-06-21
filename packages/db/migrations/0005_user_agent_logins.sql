-- Migration: user_agent_logins table (FUL-59)
-- Per-user registry of AI agent identities per integration.
-- Registered logins auto-populate feed filters and Slack alert botUserLogins.

CREATE TYPE "agent_integration" AS ENUM ('github', 'linear', 'jira');

CREATE TABLE "user_agent_logins" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "integration" "agent_integration" NOT NULL,
  "login"       text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_agent_logins_user_integration_login_uniq"
    UNIQUE ("user_id", "integration", "login")
);

CREATE INDEX "user_agent_logins_user_id_idx" ON "user_agent_logins" ("user_id");
