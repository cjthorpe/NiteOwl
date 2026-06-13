-- Migration: add enabled + updated_at to slack_alert_configs (FUL-26)
ALTER TABLE "slack_alert_configs"
  ADD COLUMN "enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN "updated_at" timestamp with time zone NOT NULL DEFAULT now();
