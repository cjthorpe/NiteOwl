-- Migration: add bot_user_logins to slack_alert_configs (FUL-34)
-- Configurable list of GitHub logins treated as bot/agent mergers.
-- Empty array = alert on all merges; non-empty = only alert when sender is in list.
ALTER TABLE "slack_alert_configs"
  ADD COLUMN "bot_user_logins" text[] NOT NULL DEFAULT '{}';
