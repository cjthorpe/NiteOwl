import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const providerEnum = pgEnum("provider", [
  "github",
  "linear",
  "jira",
  "slack",
]);

export const webhookEventStatusEnum = pgEnum("webhook_event_status", [
  "received",
  "processed",
  "failed",
  "duplicate",
]);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  avatarUrl: text("avatar_url"),
  /** bcrypt hash — null for OAuth-only accounts */
  passwordHash: text("password_hash"),
  /** GitHub numeric user ID — null until GitHub OAuth is connected */
  githubId: text("github_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// oauth_tokens
// ---------------------------------------------------------------------------

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: providerEnum("provider").notNull(),
  // Encrypted application-side (AES-256-GCM) before storage; raw token never written here.
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Space-separated OAuth scopes granted for this token */
  scopes: text("scopes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OauthToken = typeof oauthTokens.$inferSelect;
export type NewOauthToken = typeof oauthTokens.$inferInsert;

// ---------------------------------------------------------------------------
// integrations
// ---------------------------------------------------------------------------

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: providerEnum("provider").notNull(),
  /** AES-256-GCM encrypted provider config JSON; base64(ciphertext):base64(iv):base64(tag) */
  configJson: jsonb("config_json"),
  /** AES-256-GCM encrypted HMAC webhook secret */
  encryptedSecret: text("encrypted_secret"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

// ---------------------------------------------------------------------------
// activity_events
// ---------------------------------------------------------------------------

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    eventType: text("event_type").notNull(),
    /** Provider's native event identifier — combined with integration_id for idempotent ingestion */
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Primary query pattern: newest events first per user.
    index("activity_events_user_id_occurred_at_idx").on(
      table.userId,
      table.occurredAt.desc(),
    ),
    // Secondary lookup: events per integration ordered by time.
    index("activity_events_integration_id_occurred_at_idx").on(
      table.integrationId,
      table.occurredAt,
    ),
    // Idempotent ingestion: same external event from the same integration stored once.
    unique("activity_events_integration_external_uniq").on(
      table.integrationId,
      table.externalId,
    ),
  ],
);

export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;

// ---------------------------------------------------------------------------
// slack_alert_configs
// ---------------------------------------------------------------------------

export const slackAlertConfigs = pgTable("slack_alert_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Slack Incoming Webhook URL — AES-256-GCM encrypted before storage */
  webhookUrlEncrypted: text("webhook_url_encrypted").notNull(),
  /** Repo slugs to watch, e.g. ["owner/repo", "owner/other-repo"] */
  watchedRepos: text("watched_repos").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SlackAlertConfig = typeof slackAlertConfigs.$inferSelect;
export type NewSlackAlertConfig = typeof slackAlertConfigs.$inferInsert;

// ---------------------------------------------------------------------------
// webhook_events  (idempotency table)
// ---------------------------------------------------------------------------

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    /** Provider-assigned delivery ID (e.g. X-GitHub-Delivery header) */
    deliveryId: text("delivery_id"),
    /** SHA-256 hash of the raw payload body — fallback idempotency key */
    payloadHash: text("payload_hash").notNull(),
    eventType: text("event_type"),
    status: webhookEventStatusEnum("status").notNull().default("received"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("webhook_events_provider_hash_uniq").on(
      table.provider,
      table.payloadHash,
    ),
    index("webhook_events_delivery_id_idx").on(table.provider, table.deliveryId),
  ],
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
export type WebhookEventStatus =
  (typeof webhookEventStatusEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// refresh_tokens
// ---------------------------------------------------------------------------

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hex digest of the raw opaque token sent in the cookie */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("refresh_tokens_user_id_idx").on(table.userId),
    index("refresh_tokens_token_hash_idx").on(table.tokenHash),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
