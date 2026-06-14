# @niteowl/db

PostgreSQL database package for NiteOwl, managed via **Drizzle ORM**.

## Schema

Full schema documentation — tables, enums, indexes, ERD diagram, and encryption notes — is in [SCHEMA.md](./SCHEMA.md).

## Quick Start

```sh
# Generate migration files from schema changes
pnpm --filter @niteowl/db db:generate

# Apply migrations to a running Postgres instance
DATABASE_URL=postgres://user:pass@host/db pnpm --filter @niteowl/db db:migrate

# Seed local dev data
DATABASE_URL=postgres://user:pass@host/db pnpm --filter @niteowl/db db:seed

# Open Drizzle Studio (visual DB browser)
DATABASE_URL=postgres://user:pass@host/db pnpm --filter @niteowl/db db:studio
```

## Environment Variables

| Variable            | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL connection string                                                       |
| `DB_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM field encryption. Generate: `openssl rand -hex 32` |

## Package Exports

```ts
import { createDb, schema } from '@niteowl/db';

const db = createDb(process.env.DATABASE_URL);
```

See [SCHEMA.md](./SCHEMA.md) for all exported types.
