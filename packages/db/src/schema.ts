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
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const providerEnum = pgEnum('provider', ['github', 'linear', 'jira', 'slack']);

/**
 * Commercial plan tier attached to an account (the `users` row in this
 * single-tenant model). `free` is the open-source default; `pro` and
 * `enterprise` are additive commercial overlays.
 *
 * These values are the persisted source of truth and MUST stay in sync with
 * the `PlanTier` union in `@niteowl/shared` (src/entitlements.ts), which maps
 * each tier to its capability set. The `hasFeature()` helper there treats a
 * missing/unknown tier as `free`, so the free capability set is always the
 * default path.
 */
export const planEnum = pgEnum('plan', ['free', 'pro', 'enterprise']);

/** Persisted plan tier — see `planEnum`. */
export type Plan = (typeof planEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull().default(''),
  avatarUrl: text('avatar_url'),
  /** bcrypt hash — null for OAuth-only accounts */
  passwordHash: text('password_hash'),
  /** GitHub numeric user ID — null until GitHub OAuth is connected */
  githubId: text('github_id').unique(),
  /**
   * Commercial plan tier for this account. Defaults to `free` — the
   * open-source capability set — so an account with no explicit upgrade always
   * resolves to free behaviour via `hasFeature()` in `@niteowl/shared`.
   */
  plan: planEnum('plan').notNull().default('free'),
  /**
   * Timestamp of the most recent session start. Snapshotted into the JWT at
   * login so the feed can compute a "since last login" window that stays stable
   * for the entire session (no collapse-to-zero on refresh).
   */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// oauth_tokens
// ---------------------------------------------------------------------------

export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: providerEnum('provider').notNull(),
  // AES-256-GCM encrypted before storage; raw token never written here.
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Space-separated OAuth scopes granted, e.g. "repo read:user" */
  scopes: text('scopes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OauthToken = typeof oauthTokens.$inferSelect;
export type NewOauthToken = typeof oauthTokens.$inferInsert;

// ---------------------------------------------------------------------------
// integrations
// ---------------------------------------------------------------------------

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: providerEnum('provider').notNull(),
  /** AES-256-GCM encrypted JSON config; decrypted at application layer */
  configJson: jsonb('config_json'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
});

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

// ---------------------------------------------------------------------------
// activity_events
// ---------------------------------------------------------------------------

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    provider: providerEnum('provider').notNull(),
    eventType: text('event_type').notNull(),
    /** Provider-native event ID — combined with integration_id for idempotent ingestion */
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    metadata: jsonb('metadata'),
    /**
     * Extracted from metadata at ingestion time — GitHub login, Linear actor name,
     * Jira display name, etc. Enables feed filtering by ?author= without a JSON scan.
     */
    authorLogin: text('author_login'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Primary query pattern: newest events first per user.
    index('activity_events_user_id_occurred_at_idx').on(table.userId, table.occurredAt.desc()),
    // Secondary pattern: all events for a given integration ordered by time.
    index('activity_events_integration_id_occurred_at_idx').on(
      table.integrationId,
      table.occurredAt,
    ),
    // Author filter pattern: feed filtered by agent login, newest first.
    index('activity_events_author_login_occurred_at_idx').on(
      table.authorLogin,
      table.occurredAt.desc(),
    ),
    // Idempotent ingestion: same external event per integration never inserted twice.
    unique('activity_events_integration_external_uniq').on(table.integrationId, table.externalId),
  ],
);

export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;

// ---------------------------------------------------------------------------
// slack_alert_configs
// ---------------------------------------------------------------------------

export const slackAlertConfigs = pgTable('slack_alert_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** AES-256-GCM encrypted Slack incoming-webhook URL */
  webhookUrlEncrypted: text('webhook_url_encrypted').notNull(),
  /** Repo full-names to watch, e.g. ["owner/repo", "org/another"] */
  watchedRepos: text('watched_repos').array().notNull().default([]),
  /**
   * GitHub logins considered "bot/agent" mergers.
   * When non-empty, alerts only fire when the PR sender login is in this list.
   * An empty array means "alert on all merges regardless of who merged".
   */
  botUserLogins: text('bot_user_logins').array().notNull().default([]),
  /** Whether alerts are active — can be toggled independently of feed integrations */
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SlackAlertConfig = typeof slackAlertConfigs.$inferSelect;
export type NewSlackAlertConfig = typeof slackAlertConfigs.$inferInsert;

// ---------------------------------------------------------------------------
// webhook_events  (idempotency table)
// ---------------------------------------------------------------------------

export const webhookEventStatusEnum = pgEnum('webhook_event_status', [
  'received',
  'processed',
  'failed',
  'duplicate',
]);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerEnum('provider').notNull(),
    // Provider-assigned delivery ID (e.g. X-GitHub-Delivery header).
    deliveryId: text('delivery_id'),
    // SHA-256 hash of the raw payload body — fallback idempotency key.
    payloadHash: text('payload_hash').notNull(),
    eventType: text('event_type'),
    status: webhookEventStatusEnum('status').notNull().default('received'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique index guarantees each payload is processed exactly once.
    unique('webhook_events_provider_hash_uniq').on(table.provider, table.payloadHash),
    // Also deduplicate by provider delivery ID when present.
    index('webhook_events_delivery_id_idx').on(table.provider, table.deliveryId),
  ],
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
export type WebhookEventStatus = (typeof webhookEventStatusEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// refresh_tokens
// ---------------------------------------------------------------------------

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 hex digest of the raw opaque token sent in the cookie */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set when this token is consumed (rotated). Non-null means the token was
     * already used and has been superseded by a new one. If a non-null token
     * arrives again within the expiry window it indicates theft — trigger the
     * nuclear revocation path.
     */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (table) => [
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_token_hash_idx').on(table.tokenHash),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

// ---------------------------------------------------------------------------
// password_reset_tokens
// ---------------------------------------------------------------------------
// Single-use, short-lived tokens backing the self-service "forgot password"
// flow. The raw token is emailed to the user and never persisted — only its
// SHA-256 fingerprint is stored, mirroring refresh_tokens.

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 hex digest of the raw opaque token emailed to the user */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Set when the token is redeemed. Non-null means the token is spent and
     * must be rejected — enforces single-use semantics.
     */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // token_hash is the sole lookup key — unique enforces the at-most-once
    // invariant at the DB layer (and backs the lookup index).
    unique('password_reset_tokens_token_hash_uniq').on(table.tokenHash),
    index('password_reset_tokens_user_id_idx').on(table.userId),
  ],
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ---------------------------------------------------------------------------
// user_agent_logins
// ---------------------------------------------------------------------------
// Per-user registry of AI agent identities per integration.
// Registered logins auto-populate feed filters and Slack alert botUserLogins.

export const agentIntegrationEnum = pgEnum('agent_integration', ['github', 'linear', 'jira']);

export const userAgentLogins = pgTable(
  'user_agent_logins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Which integration this login belongs to (github / linear / jira) */
    integration: agentIntegrationEnum('integration').notNull(),
    /** The agent's login/username on that integration, e.g. "my-bot[bot]" */
    login: text('login').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Each (user, integration, login) triple must be unique.
    unique('user_agent_logins_user_integration_login_uniq').on(
      table.userId,
      table.integration,
      table.login,
    ),
    // Fast lookup of all logins for a user.
    index('user_agent_logins_user_id_idx').on(table.userId),
  ],
);

export type UserAgentLogin = typeof userAgentLogins.$inferSelect;
export type NewUserAgentLogin = typeof userAgentLogins.$inferInsert;

// ---------------------------------------------------------------------------
// personal_access_tokens
// ---------------------------------------------------------------------------
// Opaque, DB-backed Personal Access Tokens (PATs) — let OAuth-only users (who
// have no password) mint a revocable Bearer token for headless/CLI/curl use.
// The raw token is shown exactly once at creation and never persisted; only its
// SHA-256 fingerprint is stored, mirroring refresh_tokens / password_reset_tokens.
// The raw token carries a `niteowl_pat_` prefix so the auth plugin can cheaply
// distinguish a PAT from a JWT before any DB lookup or signature verification.

export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Human-readable label chosen at creation, e.g. "laptop CLI" */
    name: text('name').notNull(),
    /** SHA-256 hex digest of the raw opaque token — the sole lookup key */
    tokenHash: text('token_hash').notNull(),
    /** Space-separated scopes — nullable, reserved for future fine-grained perms */
    scopes: text('scopes'),
    /** Throttled bump on each successful auth — last time the token was used */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Null means the token never expires */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Set when revoked via DELETE — non-null means the token must be rejected */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // token_hash is the sole lookup key on every authenticated request — UNIQUE
    // enforces at-most-once and backs the lookup index.
    unique('personal_access_tokens_token_hash_uniq').on(table.tokenHash),
    // Fast listing of all tokens for a user (management endpoints).
    index('personal_access_tokens_user_id_idx').on(table.userId),
  ],
);

export type PersonalAccessToken = typeof personalAccessTokens.$inferSelect;
export type NewPersonalAccessToken = typeof personalAccessTokens.$inferInsert;
