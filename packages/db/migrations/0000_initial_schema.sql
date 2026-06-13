-- NiteOwl — initial schema
-- Migration: 0000_initial_schema
-- Generated: 2026-06-12

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "provider" AS ENUM ('github', 'linear', 'jira', 'slack');
CREATE TYPE "webhook_event_status" AS ENUM ('received', 'processed', 'failed', 'duplicate');

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE "users" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"         TEXT NOT NULL UNIQUE,
  "display_name"  TEXT NOT NULL DEFAULT '',
  "avatar_url"    TEXT,
  "password_hash" TEXT,
  "github_id"     TEXT UNIQUE,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- oauth_tokens
-- token fields are AES-256-GCM encrypted at the application layer before storage
-- ---------------------------------------------------------------------------

CREATE TABLE "oauth_tokens" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                  UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider"                 "provider" NOT NULL,
  "access_token_encrypted"   TEXT NOT NULL,
  "refresh_token_encrypted"  TEXT,
  "expires_at"               TIMESTAMPTZ,
  "scopes"                   TEXT,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- integrations
-- config_json is AES-256-GCM encrypted at the application layer before storage
-- ---------------------------------------------------------------------------

CREATE TABLE "integrations" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"          UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider"         "provider" NOT NULL,
  "config_json"      JSONB,
  "encrypted_secret" TEXT,
  "enabled"          BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "connected_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_synced_at"   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- activity_events
-- ---------------------------------------------------------------------------

CREATE TABLE "activity_events" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"          UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "integration_id"   UUID NOT NULL REFERENCES "integrations"("id") ON DELETE CASCADE,
  "provider"         "provider" NOT NULL,
  "event_type"       TEXT NOT NULL,
  "external_id"      TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "url"              TEXT,
  "metadata"         JSONB,
  "occurred_at"      TIMESTAMPTZ NOT NULL,
  "ingested_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query pattern: newest events first per user
CREATE INDEX "activity_events_user_id_occurred_at_idx"
  ON "activity_events" ("user_id", "occurred_at" DESC);

-- Secondary pattern: all events for a given integration ordered by time
CREATE INDEX "activity_events_integration_id_occurred_at_idx"
  ON "activity_events" ("integration_id", "occurred_at");

-- Idempotent ingestion: same external event per integration stored exactly once
ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_integration_external_uniq"
  UNIQUE ("integration_id", "external_id");

-- ---------------------------------------------------------------------------
-- slack_alert_configs
-- webhook_url_encrypted is AES-256-GCM encrypted at the application layer
-- ---------------------------------------------------------------------------

CREATE TABLE "slack_alert_configs" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"               UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "webhook_url_encrypted" TEXT NOT NULL,
  "watched_repos"         TEXT[] NOT NULL DEFAULT '{}',
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- webhook_events  (idempotency / audit table)
-- ---------------------------------------------------------------------------

CREATE TABLE "webhook_events" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider"      "provider" NOT NULL,
  "delivery_id"   TEXT,
  "payload_hash"  TEXT NOT NULL,
  "event_type"    TEXT,
  "status"        "webhook_event_status" NOT NULL DEFAULT 'received',
  "processed_at"  TIMESTAMPTZ,
  "received_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "webhook_events_provider_hash_uniq" UNIQUE ("provider", "payload_hash")
);

CREATE INDEX "webhook_events_delivery_id_idx"
  ON "webhook_events" ("provider", "delivery_id");

-- ---------------------------------------------------------------------------
-- refresh_tokens
-- ---------------------------------------------------------------------------

CREATE TABLE "refresh_tokens" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash"  TEXT NOT NULL,
  "expires_at"  TIMESTAMPTZ NOT NULL,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "refresh_tokens_user_id_idx"   ON "refresh_tokens" ("user_id");
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens" ("token_hash");
