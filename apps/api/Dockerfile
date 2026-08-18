# Raven control plane API.
#
# Deliberately a single, simple stage for Phase 2 — a size/layer-optimized
# multi-stage build belongs to Phase 11 (Production Deployment), not here.
# Build context is the REPO ROOT (see docker-compose.yml's `build.context`)
# because this is a pnpm workspace package that needs its siblings visible
# to resolve dependencies correctly.

FROM node:26-alpine

WORKDIR /app

# Prisma's query engine needs libssl on musl (Alpine) — without it, Prisma
# falls back to a guessed OpenSSL version and prints a startup warning.
RUN apk add --no-cache openssl

RUN npm install -g pnpm@11.22.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api

RUN pnpm --filter @raven/api run prisma:generate \
  && pnpm --filter @raven/api run build

WORKDIR /app/apps/api

EXPOSE 4100

# `prisma migrate deploy` only applies existing migrations (never creates
# new ones) and is safe to run on every container start — see
# docs/control-plane.md#database-migrations.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
