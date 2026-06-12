# NiteOwl

Monorepo for the NiteOwl application — React/TypeScript frontend, Node.js API backend, and shared utilities.

## Structure

```
niteowl/
├── apps/
│   ├── api/          Node.js + Express API (port 3001)
│   └── web/          React + Vite frontend (port 5173)
├── packages/
│   └── shared/       Shared types and utilities
└── docker-compose.yml
```

## Prerequisites

- [Node.js 20 LTS](https://nodejs.org)
- [pnpm 9+](https://pnpm.io/installation) (`npm install -g pnpm`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Docker Compose)

## Local Development

### One-command Docker start

```bash
cp .env.example .env
docker compose up
```

This starts:
- **postgres** on `localhost:5432`
- **redis** on `localhost:6379`
- **api** on `http://localhost:3001`
- **web** on `http://localhost:5173`

Live reload is enabled via Docker Compose Watch (sync on source changes, rebuild on dependency changes).

### Native development (without Docker)

```bash
# Install dependencies
pnpm install

# Copy environment
cp .env.example .env

# Start all apps in parallel
pnpm dev
```

You'll need Postgres and Redis running locally (or update `.env` to point to Docker instances).

## Scripts

From the repo root:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all packages |
| `pnpm lint` | ESLint across all packages |
| `pnpm lint:fix` | ESLint with auto-fix |
| `pnpm format` | Prettier format all files |
| `pnpm format:check` | Prettier check (used in CI) |
| `pnpm typecheck` | TypeScript type-check all packages |
| `pnpm test` | Run all tests |

## Environment Variables

Copy `.env.example` to `.env` and adjust values for your environment. See `.env.example` for all variables and their documentation.

## CI

GitHub Actions runs on every push/PR to `main`:
1. Install dependencies (pnpm cache)
2. Lint
3. Format check
4. Type-check
5. Build `@niteowl/shared`
6. Test all packages

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
