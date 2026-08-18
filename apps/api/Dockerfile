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

# npm exists in the base image solely to install pnpm, so it is removed
# immediately afterwards. That drops npm's bundled copy of node-tar, which
# carries CVE-2026-59873 (a gzip bomb can exhaust disk and CPU; fixed in
# tar 7.5.19). Nothing in Raven imports it, but an unused vulnerable file
# in a production image is still a vulnerable file — and the runtime only
# ever needs pnpm and node.
RUN npm install -g pnpm@11.22.0 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api

# `prisma generate` only reads the schema (it never connects), but
# prisma.config.ts resolves DATABASE_URL eagerly just to build the config
# object — this placeholder satisfies that at build time only; the real
# value comes from docker-compose.yml's `environment:` at container run
# time and is what the app actually connects with.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

RUN pnpm --filter @raven/api run prisma:generate \
  && pnpm --filter @raven/api run build

WORKDIR /app/apps/api

EXPOSE 4100

# `prisma migrate deploy` only applies existing migrations (never creates
# new ones), so it's safe to run on every container start.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
