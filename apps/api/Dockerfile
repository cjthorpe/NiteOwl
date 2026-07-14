# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# ─── Base ──────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate

# ─── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .pnpmfile.cjs ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

# ─── Development ───────────────────────────────────────────────────────────────
FROM deps AS development
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY packages/types ./packages/types
COPY packages/db ./packages/db
RUN pnpm --filter "@niteowl/types" build && \
    pnpm --filter "@niteowl/shared" build && \
    pnpm --filter "@niteowl/db" build
EXPOSE 3001
# The API runs from source via tsx, but it imports the workspace packages
# (@niteowl/db, /shared, /types) through their compiled `dist` (their package
# `main`). `compose watch` syncs those packages' `src` into the container, so we
# MUST keep their `dist` recompiling — otherwise a schema/source change leaves a
# stale `dist` and lookups like `schema.personalAccessTokens` resolve to
# `undefined` at runtime (FUL-96). Run each package's `tsc --watch` alongside the
# API's `tsx watch` so synced source is always rebuilt before the API reloads.
CMD ["pnpm", "--parallel", \
     "--filter", "@niteowl/types", \
     "--filter", "@niteowl/shared", \
     "--filter", "@niteowl/db", \
     "--filter", "@niteowl/api", \
     "run", "dev"]

# ─── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY packages/types ./packages/types
COPY packages/db ./packages/db
# Build in dependency order: @niteowl/shared imports @niteowl/types, so types
# must be compiled first (mirrors the `development` stage above). Building shared
# before types fails with TS2307 "Cannot find module '@niteowl/types'" (FUL-155).
RUN pnpm --filter "@niteowl/types" build && \
    pnpm --filter "@niteowl/shared" build && \
    pnpm --filter "@niteowl/db" build && \
    pnpm --filter "@niteowl/api" build

# ─── Production ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .pnpmfile.cjs ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
