# NiteOwl — Database Schema

PostgreSQL schema managed via **Drizzle ORM**. All table definitions live in `src/schema.ts`; the authoritative migration is `migrations/0000_tiny_stardust.sql`.

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                             users                                   │
│  id (PK)  email (UQ)  display_name  avatar_url  password_hash       │
│  github_id (UQ)  created_at  updated_at                            │
└─────────────┬───────────────────────────────────────────────────────┘
              │ CASCADE DELETE
              ├──────────────────────────────────────────┐
              │                                          │
              ▼                                          ▼
┌─────────────────────────┐              ┌──────────────────────────────┐
│      oauth_tokens       │              │         integrations         │
│  id (PK)                │              │  id (PK)                     │
│  user_id (FK→users)     │              │  user_id (FK→users)          │
│  provider (enum)        │              │  provider (enum)             │
│  access_token_encrypted │              │  config_json (JSONB)         │
│  refresh_token_encrypted│              │  enabled                     │
│  expires_at             │              │  created_at                  │
│  scopes                 │              │  connected_at                │
│  created_at             │              │  last_synced_at              │
│  updated_at             │              └──────────────┬───────────────┘
└─────────────────────────┘                            │ CASCADE DELETE
                                                       │
              ┌────────────────────────────────────────┤
              │                                        │
              ▼                                        │
┌─────────────────────────────────────────────────┐   │
│                  activity_events                │◄──┘
│  id (PK)                                        │
│  user_id (FK→users)                             │
│  integration_id (FK→integrations)               │
│  provider (enum)                                │
│  event_type                                     │
│  external_id  ─── UNIQUE(integration_id,        │
│  title            external_id)                  │
│  url                                            │
│  metadata (JSONB)                               │
│  occurred_at   ◄── INDEX(user_id, occurred_at↓) │
│  ingested_at   ◄── INDEX(integration_id,        │
│                          occurred_at)           │
└─────────────────────────────────────────────────┘

┌──────────────────────────────┐   ┌────────────────────────────────┐
│     slack_alert_configs      │   │         refresh_tokens         │
│  id (PK)                     │   │  id (PK)                       │
│  user_id (FK→users)          │   │  user_id (FK→users)            │
│  webhook_url_encrypted       │   │  token_hash  ◄── INDEX         │
│  watched_repos (text[])      │   │  expires_at                    │
│  created_at                  │   │  created_at                    │
└──────────────────────────────┘   └────────────────────────────────┘

┌───────────────────────────────────────────┐
│             webhook_events                │
│  id (PK)                                  │
│  provider (enum)                          │
│  delivery_id  ◄── INDEX(provider,         │
│                          delivery_id)     │
│  payload_hash ─── UNIQUE(provider,        │
│                          payload_hash)    │
│  event_type                               │
│  status (enum: received|processed|…)      │
│  processed_at                             │
│  received_at                              │
└───────────────────────────────────────────┘
```

## Enums

| Enum                   | Values                                         |
| ---------------------- | ---------------------------------------------- |
| `provider`             | `github`, `linear`, `jira`, `slack`            |
| `webhook_event_status` | `received`, `processed`, `failed`, `duplicate` |

## Tables

### `users`

| Column          | Type          | Notes                                   |
| --------------- | ------------- | --------------------------------------- |
| `id`            | `uuid`        | PK, `gen_random_uuid()`                 |
| `email`         | `text`        | NOT NULL, UNIQUE                        |
| `display_name`  | `text`        | NOT NULL, default `''`                  |
| `avatar_url`    | `text`        | nullable                                |
| `password_hash` | `text`        | nullable — null for OAuth-only accounts |
| `github_id`     | `text`        | UNIQUE, nullable                        |
| `created_at`    | `timestamptz` | NOT NULL, `now()`                       |
| `updated_at`    | `timestamptz` | NOT NULL, `now()`                       |

### `oauth_tokens`

Stores per-provider OAuth credentials. **Token values are AES-256-GCM encrypted** at the application layer before insertion.

| Column                    | Type            | Notes                           |
| ------------------------- | --------------- | ------------------------------- |
| `id`                      | `uuid`          | PK                              |
| `user_id`                 | `uuid`          | FK → `users.id` CASCADE DELETE  |
| `provider`                | `provider` enum | NOT NULL                        |
| `access_token_encrypted`  | `text`          | AES-256-GCM encrypted           |
| `refresh_token_encrypted` | `text`          | AES-256-GCM encrypted, nullable |
| `expires_at`              | `timestamptz`   | nullable                        |
| `scopes`                  | `text`          | space-separated OAuth scopes    |
| `created_at`              | `timestamptz`   | NOT NULL                        |
| `updated_at`              | `timestamptz`   | NOT NULL                        |

### `integrations`

One row per (user, provider) connection. Config is stored as encrypted JSONB.

| Column           | Type            | Notes                              |
| ---------------- | --------------- | ---------------------------------- |
| `id`             | `uuid`          | PK                                 |
| `user_id`        | `uuid`          | FK → `users.id` CASCADE DELETE     |
| `provider`       | `provider` enum | NOT NULL                           |
| `config_json`    | `jsonb`         | provider-specific config, nullable |
| `enabled`        | `boolean`       | NOT NULL, default `true`           |
| `created_at`     | `timestamptz`   | NOT NULL                           |
| `connected_at`   | `timestamptz`   | NOT NULL                           |
| `last_synced_at` | `timestamptz`   | nullable                           |

### `activity_events`

Core feed table. Indexed for fast per-user time-ordered queries. Idempotent ingestion enforced by unique constraint.

| Column           | Type            | Notes                                  |
| ---------------- | --------------- | -------------------------------------- |
| `id`             | `uuid`          | PK                                     |
| `user_id`        | `uuid`          | FK → `users.id` CASCADE DELETE         |
| `integration_id` | `uuid`          | FK → `integrations.id` CASCADE DELETE  |
| `provider`       | `provider` enum | NOT NULL                               |
| `event_type`     | `text`          | NOT NULL (e.g. `push`, `pull_request`) |
| `external_id`    | `text`          | NOT NULL — provider-native event ID    |
| `title`          | `text`          | NOT NULL                               |
| `url`            | `text`          | nullable                               |
| `metadata`       | `jsonb`         | arbitrary provider payload, nullable   |
| `occurred_at`    | `timestamptz`   | NOT NULL                               |
| `ingested_at`    | `timestamptz`   | NOT NULL, `now()`                      |

**Indexes:**

- `activity_events_user_id_occurred_at_idx` — `(user_id, occurred_at DESC)` — primary feed query
- `activity_events_integration_id_occurred_at_idx` — `(integration_id, occurred_at)` — per-integration view

**Constraints:**

- `activity_events_integration_external_uniq` — UNIQUE `(integration_id, external_id)` — prevents duplicate ingestion

### `slack_alert_configs`

Per-user Slack alert configuration. Webhook URL is AES-256-GCM encrypted.

| Column                  | Type          | Notes                                   |
| ----------------------- | ------------- | --------------------------------------- |
| `id`                    | `uuid`        | PK                                      |
| `user_id`               | `uuid`        | FK → `users.id` CASCADE DELETE          |
| `webhook_url_encrypted` | `text`        | AES-256-GCM encrypted Slack webhook URL |
| `watched_repos`         | `text[]`      | repo full names, e.g. `["owner/repo"]`  |
| `created_at`            | `timestamptz` | NOT NULL                                |

### `webhook_events`

Idempotency and audit table for inbound provider webhooks.

| Column         | Type                        | Notes                              |
| -------------- | --------------------------- | ---------------------------------- |
| `id`           | `uuid`                      | PK                                 |
| `provider`     | `provider` enum             | NOT NULL                           |
| `delivery_id`  | `text`                      | provider delivery header, nullable |
| `payload_hash` | `text`                      | SHA-256 of raw body, NOT NULL      |
| `event_type`   | `text`                      | nullable                           |
| `status`       | `webhook_event_status` enum | default `received`                 |
| `processed_at` | `timestamptz`               | nullable                           |
| `received_at`  | `timestamptz`               | NOT NULL, `now()`                  |

**Constraints:**

- `webhook_events_provider_hash_uniq` — UNIQUE `(provider, payload_hash)`

**Indexes:**

- `webhook_events_delivery_id_idx` — `(provider, delivery_id)`

### `refresh_tokens`

Session refresh tokens. Stored as SHA-256 hashes — raw tokens are never persisted.

| Column       | Type          | Notes                          |
| ------------ | ------------- | ------------------------------ |
| `id`         | `uuid`        | PK                             |
| `user_id`    | `uuid`        | FK → `users.id` CASCADE DELETE |
| `token_hash` | `text`        | SHA-256 hex of the raw token   |
| `expires_at` | `timestamptz` | NOT NULL                       |
| `created_at` | `timestamptz` | NOT NULL                       |

**Indexes:**

- `refresh_tokens_user_id_idx` — `(user_id)`
- `refresh_tokens_token_hash_idx` — `(token_hash)`

## Encryption

Sensitive fields (`access_token_encrypted`, `refresh_token_encrypted`, `webhook_url_encrypted`) use **AES-256-GCM** authenticated encryption implemented in `src/encryption.ts`.

**Wire format:** `<iv_b64url>.<ciphertext_b64url>.<auth_tag_b64url>`

**Key:** `DB_ENCRYPTION_KEY` environment variable — 32-byte hex string (64 hex chars).

Generate with:

```sh
openssl rand -hex 32
```

## Running Migrations

```sh
# Apply migrations to a running Postgres instance
DATABASE_URL=postgres://user:pass@host/db pnpm --filter @niteowl/db db:migrate
```

## Seeding Local Dev Data

```sh
DATABASE_URL=postgres://user:pass@host/db pnpm --filter @niteowl/db db:seed
```

Seeds 3 users, 4 integrations per user, 30 activity events per user, slack alert configs, and webhook event records.
