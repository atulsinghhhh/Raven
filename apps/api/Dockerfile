# Raven control plane API — multi-stage build.
#
# Stage 1 (deps): full workspace deps, including devDependencies, needed
# to compile TypeScript and generate the Prisma client. Stage 2 (build):
# does that compiling. Stage 3 (runtime): a *separate*, prod-only `pnpm
# install` for node_modules — devDependencies (typescript, jest, eslint,
# ts-node, ...) have no reason to ship in the image that actually runs —
# with the compiled apps/api tree copied in from the build stage as-is
# rather than just `dist/`: the generated Prisma client carries its own
# native query-engine binary alongside its compiled JS, and copying the
# whole directory keeps that pairing exactly as `prisma generate` wrote
# it, instead of risking a broken relative path by reassembling it.
#
# Build context is the repo root (see docker-compose.yml's
# `build.context`) since this is a pnpm workspace package and needs its
# siblings visible to resolve deps.

FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@11.22.0 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api

# `prisma generate` only reads the schema (it never connects), but
# prisma.config.ts resolves DATABASE_URL eagerly just to build the config
# object — this placeholder satisfies that at build time only; the real
# value comes from the runtime environment (api-secret.yaml in
# infrastructure/k8s, or docker-compose.yml's `environment:` locally).
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

RUN pnpm --filter @raven/api run prisma:generate \
  && pnpm --filter @raven/api run build

FROM node:22-alpine AS runtime
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
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/apps/api apps/api

WORKDIR /app/apps/api

EXPOSE 4100

# node:22-alpine ships a built-in, unprivileged `node` user (uid 1000) —
# matches infrastructure/k8s's `runAsNonRoot: true`. Owning the app
# directory isn't needed: nothing under it is written to at runtime
# (Prisma migrations write to Postgres, not to this filesystem).
USER node

# `prisma migrate deploy` only applies existing migrations (never creates
# new ones), so it's safe to run on every container start.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
