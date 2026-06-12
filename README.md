# NiteOwl

Monorepo for the NiteOwl application — React/TypeScript frontend, Fastify API, Drizzle ORM, shared types.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, TypeScript (strict), Vite |
| API | Node.js 20 LTS, Fastify 4, TypeScript |
| Database | PostgreSQL 16 via Drizzle ORM |
| Cache / Queue | Redis 7, ioredis |
| Package manager | pnpm workspaces + Turborepo |
| Containers | Docker Compose v2 |
| Deployment | Railway (see `railway.toml`) |

## Monorepo layout

```
niteowl/
├── apps/
│   ├── api/          # Fastify API           (port 3001)
│   └── web/          # React / Vite SPA      (port 5173)
├── packages/
│   ├── db/           # Drizzle ORM schema + migrations
│   ├── shared/       # Runtime utility functions
│   └── types/        # Shared domain TypeScript types
├── .github/
│   └── workflows/
│       ├── ci.yml    # Lint, type-check, test, Docker build
│       └── deploy.yml# Build + push to GHCR, deploy to Railway
├── docker-compose.yml
├── turbo.json
├── .env.example
└── tsconfig.base.json
```

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) (includes Compose v2)
- [Node.js 20 LTS](https://nodejs.org/)
- [pnpm 9+](https://pnpm.io/installation): `corepack enable && corepack prepare pnpm@latest --activate`

## Local development (one command)

```bash
# 1. Clone and enter the repo
git clone <repo-url> && cd niteowl

# 2. Copy environment config
cp .env.example .env

# 3. Start everything (Postgres, Redis, API, Web — with hot-reload)
docker compose watch
```

Services will be available at:

| Service | URL |
|---------|-----|
| Web | http://localhost:5173 |
| API | http://localhost:3001 |
| API health | http://localhost:3001/health |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

`docker compose watch` uses the `develop.watch` directives in `docker-compose.yml` for hot-reload without volume mounts.

## Running without Docker (optional)

```bash
pnpm install
pnpm build          # builds shared → types → db → api → web
pnpm dev            # starts api + web in parallel via Turborepo
```

> You will need a local PostgreSQL and Redis instance, or set `DATABASE_URL` and `REDIS_URL` to Docker services started separately.

## Database migrations

```bash
# Generate a new migration from schema changes
pnpm --filter "@niteowl/db" db:generate

# Apply pending migrations
pnpm --filter "@niteowl/db" db:migrate

# Open Drizzle Studio
pnpm --filter "@niteowl/db" db:studio
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in watch mode (Turborepo) |
| `pnpm build` | Build all packages in dependency order |
| `pnpm lint` | Run ESLint across the repo |
| `pnpm format` | Run Prettier |
| `pnpm typecheck` | TypeScript check (no emit) |
| `pnpm test` | Run all Vitest suites |

## Environment variables

See `.env.example` for all variables with inline descriptions. Copy to `.env` and fill in values. Never commit `.env`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` / `develop` and on all pull requests:

1. **Lint & Format** — ESLint + Prettier check
2. **Type Check** — `tsc --noEmit` across all packages
3. **Test** — Vitest across all packages
4. **Docker Build Check** — validates both Dockerfiles build to the `builder` stage

The **deploy workflow** (`.github/workflows/deploy.yml`) triggers on pushes to `main`, builds production Docker images, pushes them to GHCR, and deploys both services to Railway. Requires `RAILWAY_TOKEN` secret.
