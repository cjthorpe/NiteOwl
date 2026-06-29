FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .pnpmfile.cjs ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
# The web bundle imports the node-free `@niteowl/shared/briefing-digest` subpath
# (FUL-122/FUL-136), which resolves through the package `exports` map to its
# compiled `dist`. `dist` is gitignored and excluded by `.dockerignore`, so it is
# absent on a fresh checkout — Vite then fails import-analysis with "Failed to
# resolve import @niteowl/shared/briefing-digest" (FUL-138). Build the workspace
# packages the bundle depends on before Vite starts (types first, since shared's
# tsc build resolves `@niteowl/types` declarations). Mirrors the API dev stage
# (FUL-96). This dist is rebuilt whenever `packages/shared/src` changes because the
# web `compose watch` triggers an image rebuild on that path (FUL-139) — otherwise
# a changed export would be missing from this one-time build and crash the app with
# "Indirectly exported binding name … not found".
RUN pnpm --filter "@niteowl/types" build && \
    pnpm --filter "@niteowl/shared" build
EXPOSE 5173
CMD ["pnpm", "--filter", "@niteowl/web", "dev"]

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @niteowl/shared build && pnpm --filter @niteowl/web build

FROM nginx:alpine AS runner
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
