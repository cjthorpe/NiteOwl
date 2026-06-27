-- Migration: add commercial plan tier to accounts (FUL-106)
-- Introduces the entitlements primitive — a `plan` enum on the `users` row
-- (the account in this single-tenant model). `free` is the open-source default
-- so every existing and new account resolves to the free capability set until
-- explicitly upgraded. `pro` and `enterprise` are additive commercial overlays.
-- The capability map + hasFeature() helper live in @niteowl/shared.
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'enterprise');--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN "plan" "public"."plan" NOT NULL DEFAULT 'free';
