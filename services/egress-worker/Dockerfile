# Live Streaming broadcast egress worker — multi-stage build.
#
# Needs the same three real, published SDK builds the browser harness page
# imports (scripts/stage-harness-sdk.mjs) — @ravenkash/rtc, @ravenkash/chat,
# @ravenkash/client — so the build stage needs the whole pnpm workspace
# visible, same reasoning as apps/api/Dockerfile. Runtime needs a real
# Chromium (Playwright's own image already carries the OS-level deps a
# headless build needs) plus ffmpeg for HLS segmentation.
#
# Build context is the repo root — see docker-compose.yml's build.context.

FROM node:22-bookworm AS deps
WORKDIR /app
RUN npm install -g pnpm@11.22.0 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services/egress-worker/package.json services/egress-worker/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/chat-sdk/package.json packages/chat-sdk/package.json
COPY packages/client/package.json packages/client/package.json
# packages/sdk's src/track.ts imports @ravenkash/effects as a type-only
# dependency — not one of the three SDK builds this image ships, but its
# package.json still needs to be resolvable for tsup's dts build to type-
# check, or @ravenkash/rtc's own build fails before ever reaching client.
COPY packages/effects/package.json packages/effects/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY services/egress-worker services/egress-worker
COPY packages/sdk packages/sdk
COPY packages/chat-sdk packages/chat-sdk
COPY packages/client packages/client
COPY packages/effects packages/effects
# effects builds first: its own dist (real type declarations, not just a
# package.json) is what @ravenkash/rtc's tsup dts build actually needs to
# resolve the `@ravenkash/effects` import in src/track.ts — a bare
# package.json satisfies pnpm's install/symlink step but not TypeScript.
RUN pnpm --filter @ravenkash/effects run build \
  && pnpm --filter @ravenkash/rtc run build \
  && pnpm --filter @ravenkash/chat run build \
  && pnpm --filter @ravenkash/client run build \
  && pnpm --filter @raven/egress-worker run stage-sdk --no-build \
  && pnpm --filter @raven/egress-worker run build

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.22.0
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services/egress-worker/package.json services/egress-worker/package.json
RUN pnpm install --frozen-lockfile --prod --filter @raven/egress-worker

COPY --from=build /app/services/egress-worker/dist services/egress-worker/dist

WORKDIR /app/services/egress-worker

EXPOSE 8600

# Playwright's own base image already runs as root by default for browser
# sandboxing reasons on some hosts; headless Chromium under Docker commonly
# needs --no-sandbox unless the container itself grants the seccomp/user-ns
# privileges a sandboxed renderer wants. Kept as root here to match that
# image's own convention rather than fighting it — this container has no
# other privileged surface.
CMD ["node", "dist/main.js"]
