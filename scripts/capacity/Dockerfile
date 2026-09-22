# Capacity-rig worker — docs/production/architecture-5k.md §4's "package
# the harness as a container image" step, and 10k-scalability-audit.md's
# Phase 6.
#
# This image holds exactly one shard of a distributed audience: it mints
# its slice of viewer identities against an already-deployed, real API,
# opens real Chromium pages against the real SFU/TURN that API's fleet
# points at, and writes its own media-alive samples to /out. It never
# boots its own API or SFU — `coordinate.mjs` (run outside this image, on
# whichever machine is publishing) owns the stream's lifecycle, and one
# `raven-capacity-worker` container per docker-run in that script is what
# makes the audience actually distributed: N renderer processes, each its
# own container, optionally each its own physical host via `docker
# --context`.
#
# Same build shape as services/egress-worker/Dockerfile: the harness
# pages import the real, published @ravenkash/rtc, @ravenkash/chat and
# @ravenkash/client builds (build-harness-sdk.mjs), so the build stage
# needs the whole pnpm workspace visible. Build context is the repo root.
#
#   docker build -f scripts/capacity/Dockerfile -t raven/capacity-worker:dev .

FROM node:22-bookworm AS deps
WORKDIR /app
RUN npm install -g pnpm@11.22.0 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY scripts/capacity/package.json scripts/capacity/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/chat-sdk/package.json packages/chat-sdk/package.json
COPY packages/client/package.json packages/client/package.json
# See services/egress-worker/Dockerfile's identical line: packages/sdk's
# src/track.ts imports @ravenkash/effects as a type-only dependency, so
# tsup's dts build needs it resolvable even though this image never ships it.
COPY packages/effects/package.json packages/effects/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY scripts/capacity scripts/capacity
COPY packages/sdk packages/sdk
COPY packages/chat-sdk packages/chat-sdk
COPY packages/client packages/client
COPY packages/effects packages/effects
RUN pnpm --filter @ravenkash/effects run build \
  && pnpm --filter @ravenkash/rtc run build \
  && pnpm --filter @ravenkash/chat run build \
  && pnpm --filter @ravenkash/client run build \
  && pnpm --filter @raven/capacity run sdk

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
RUN npm install -g pnpm@11.22.0
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY scripts/capacity/package.json scripts/capacity/package.json
# --prod still pulls ioredis and pg alongside playwright even though
# worker.mjs uses neither — they're the same @raven/capacity manifest
# run.mjs and the rest of the rig use, and splitting a worker-only
# package.json out of it would be a second dependency list to keep in
# sync for the sake of a few MB.
RUN pnpm install --frozen-lockfile --prod --filter @raven/capacity

COPY --from=build /app/scripts/capacity/worker.mjs scripts/capacity/worker.mjs
COPY --from=build /app/scripts/capacity/lib scripts/capacity/lib
COPY --from=build /app/scripts/capacity/harness scripts/capacity/harness

WORKDIR /app/scripts/capacity

# Matches egress-worker's own choice: Playwright's base image runs
# headless Chromium as root by default, and this container has no other
# privileged surface to protect.
ENTRYPOINT ["node", "worker.mjs"]
