# Raven control plane API.
#
# Single simple stage for now — a proper size/layer-optimized multi-stage
# build can wait for the production deployment work. Build context is the
# repo root (see docker-compose.yml's `build.context`) since this is a
# pnpm workspace package and needs its siblings visible to resolve deps.

FROM node:22-alpine

WORKDIR /app

# Prisma's query engine needs libssl on musl/Alpine — without it Prisma
# guesses the OpenSSL version and prints a startup warning.
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
# new ones), so it's safe to run on every container start.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
