# Raven

**Open-source real-time communication infrastructure.** Add video, voice,
chat and data to your own app — without running WebRTC or WebSocket
infrastructure yourself.

Raven is infrastructure, not a video-calling app: you get an API, SDKs and
a dashboard, and you build the product. Comparable to LiveKit Cloud, Daily
or Agora, except you can self-host the whole thing.

```
Your backend  ──API key──▶  Raven Control API  ──▶ short-lived token
                                                        │
Your frontend ◀─────────────────────────────────────────┘
      │
      └──token──▶  Raven Signaling ──▶ Raven SFU ──▶ other participants
```

- **Node.js ≥ 20**, **pnpm 11**, Docker, and a Postgres connection string.
- Media plane is Raven's own SFU: Go, built on [Pion](https://github.com/pion/webrtc).
- Everything speaks standards-compliant WebRTC — ICE, DTLS-SRTP, RTP/RTCP.

---

## Quickstart

Three steps. Nothing here needs the dashboard, and no code touches SDP,
ICE or `RTCPeerConnection`.

### 1. Your backend mints a token

Never mint one in a browser: the API key is permanent, the token is not.

```bash
npm install @corvidhq/server        # or: pip install raven-sdk
```

```ts
import { Raven } from '@corvidhq/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY! });

// Identity comes from YOUR session — never from the request body.
const grant = await raven.tokens.create({ room: roomId, identity: 'user-42' });

// grant = { token, endpoint, iceServers, telemetryUrl, expiresAt, ... }
```

### 2. Your frontend joins

```bash
npm install @corvidhq/rtc
```

```ts
import { createRTCClient } from '@corvidhq/rtc';

const client = createRTCClient({
  token: grant.token,
  endpoint: grant.endpoint,       // Raven's signaling WebSocket
  iceServers: grant.iceServers,   // never hand-build STUN/TURN config
});

const room = await client.join(roomId);

await room.enableCamera();
await room.enableMicrophone();

room.on('trackSubscribed', (track) => {
  document.body.appendChild(track.attach());
});
```

`join()` resolves once the **control plane** admits you — you can publish
immediately, but ICE and DTLS finish a moment later. Render from the
`connected` event rather than assuming:

```ts
room.on('connected', () => setStatus('live'));
// or, if you must block: await room.waitUntilConnected();
```

### 3. Or use the React bindings

```bash
npm install @corvidhq/rtc @corvidhq/react
```

```tsx
'use client';
import { RavenRoom, useConnectionState, useCamera, useLocalParticipant, ParticipantView } from '@corvidhq/react';

export function CallPage({ token, endpoint, room }) {
  return (
    <RavenRoom token={token} endpoint={endpoint} room={room} fallback={<p>Connecting…</p>}>
      <Call />
    </RavenRoom>
  );
}

function Call() {
  const state = useConnectionState();
  const camera = useCamera();
  const local = useLocalParticipant();

  return (
    <>
      <p>Status: {state}</p>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>Toggle camera</button>
      {local && <ParticipantView participant={local} />}
    </>
  );
}
```

Hooks are headless; the components are optional. Build your own UI if you
prefer — nothing forces you through `ParticipantView`.

**Runnable versions of all of the above:** [`examples/`](./examples) —
`node-server/` and `python-server/` for the backend, `video-call/` for
plain JS, `react-video-call/` for React.

---

## What's in the box

Everything below talks to the same Control API. There is no privileged
client.

### Client SDKs

| Package | Install | What it does | Reference |
|---|---|---|---|
| `@corvidhq/rtc` | `npm i @corvidhq/rtc` | Browser RTC: join, publish, subscribe | [docs/sdk.md](./docs/sdk.md) |
| `@corvidhq/react` | `npm i @corvidhq/react` | Hooks + optional components for RTC **and** chat | [docs/sdk/react.md](./docs/sdk/react.md) |
| `@corvidhq/chat` | `npm i @corvidhq/chat` | Messaging: durable, ordered, with presence and typing | [docs/sdk/chat.md](./docs/sdk/chat.md) |
| `@corvidhq/effects` | `npm i @corvidhq/effects` | Camera effects pipeline (filters, presets) | [apps/docs/content/effects.md](./apps/docs/content/effects.md) |
| `@corvidhq/react-native` | `npm i @corvidhq/react-native` | iOS + Android, reusing `@corvidhq/rtc` unmodified | [docs/sdk/react-native.md](./docs/sdk/react-native.md) |
| `raven_rtc`, `raven_chat` | Dart / pub | Flutter, same concepts in idiomatic Dart | [docs/sdk/flutter.md](./docs/sdk/flutter.md) |

### Backend SDKs

| Package | Install | Reference |
|---|---|---|
| `@corvidhq/server` | `npm i @corvidhq/server` | [docs/sdk/server/typescript.md](./docs/sdk/server/typescript.md) |
| `raven-sdk` | `pip install raven-sdk` | [docs/sdk/server/python.md](./docs/sdk/server/python.md) |

Both hold a permanent project API key that never reaches a browser, mint
short-lived RTC and chat tokens, and read rooms, connections, errors and
diagnostics. Security model: [docs/security/server-sdk.md](./docs/security/server-sdk.md).

### Tools

| Tool | What it is | Reference |
|---|---|---|
| Dashboard (`apps/dashboard`) | Projects, API keys, rooms, participants, the SFU fleet, diagnostics | [docs/dashboard.md](./docs/dashboard.md) |
| `@corvidhq/cli` | `raven login`, `raven projects create`, `raven init`, `raven rtc servers list` | [docs/cli.md](./docs/cli.md) |

---

## How it fits together

Raven has **two planes, and they fail independently.**

```
                    ┌──────────────────────────────────┐
  Your backend ────▶│  Control plane   (apps/api)      │
      API key       │  auth · projects · keys · rooms  │
                    │  tokens · chat · webhooks        │
                    └───────────┬──────────────────────┘
                                │ node link (WebSocket)
  Your frontend ────────────────┤
   short-lived    signaling     │
      token       /v1/rtc       ▼
                    ┌──────────────────────────────────┐
                    │  Media plane   (services/sfu)    │
                    │  Go · Pion · one room = one node │
                    └───────────┬──────────────────────┘
                                │ SRTP, direct
                                ▼
                          participants
                        (coturn relays when
                         no direct path exists)
```

**The control plane never carries media.** It decides *whether* you may
publish or subscribe, signs a token that says so, and negotiates SDP/ICE
between you and the node serving your room. Restarting it costs clients a
signaling reconnect, not a dropped call.

**Clients are never told an SFU's address.** A join learns the node's
*name*, for support. That is what lets the media plane be re-shaped,
re-scaled or replaced without an SDK release — and it is how the SFU was
swapped out underneath the public API without changing it.

**Chat is a separate service** with its own gateway (`/v1/chat/ws`), its
own token, and Postgres as the source of truth. Use either plane alone, or
both.

Start here: **[docs/rtc/README.md](./docs/rtc/README.md)**.

---

## Repository layout

```
apps/
  api/                Control plane + signaling gateway + chat (NestJS, Prisma)
  dashboard/          Developer console (Next.js, server components)
  docs/               Documentation site
  www/                Marketing site
  community/          Community site + its API
services/
  sfu/                The SFU. Go, Pion. The only place media is touched.
packages/
  sdk/                @corvidhq/rtc          — browser RTC
  react-sdk/          @corvidhq/react        — hooks + components
  chat-sdk/           @corvidhq/chat         — messaging
  effects/            @corvidhq/effects      — camera effects
  react-native-sdk/   @corvidhq/react-native — iOS/Android
  server-sdk/         @corvidhq/server       — backend, TypeScript
  client/             @corvidhq/client       — live-streaming client
  cli/                @corvidhq/cli          — terminal workflow
sdks/
  flutter/            raven_rtc, raven_chat, raven_live
  python/             raven-sdk
examples/             Runnable apps, one per integration path
infrastructure/       docker/ · k8s/ · azure/
docs/                 Architecture, references, operations
scripts/              Load tests, infra verification, TURN certs
```

---

## Running it locally

```bash
cp .env.example .env       # then fill in real secrets — see below
pnpm install
pnpm infra:up              # Redis, the SFU, coturn, MinIO, api
pnpm db:migrate            # apply migrations to your Postgres
pnpm infra:verify          # confirm every dependency is actually healthy
pnpm db:seed               # optional: demo developer, project, key, room
```

Then: interactive API docs at <http://localhost:4100/docs>.

**Postgres is not in the compose stack.** Raven's own deployment uses
managed Postgres, and `.env` needs `DATABASE_URL` and `DIRECT_URL` before
anything works. Any Postgres will do.

Two secrets must be distinct from each other and from `JWT_SECRET` —
production boot *refuses to start* otherwise, because a deployment where
one leaked credential mints all of them is worse than one that will not run:

```bash
openssl rand -hex 32   # RTC_TOKEN_SECRET
openssl rand -hex 32   # SFU_REGISTRATION_SECRET
```

The dashboard runs separately:

```bash
pnpm --filter @raven/dashboard build
pnpm --filter @raven/dashboard start   # http://localhost:3000
```

Ports, troubleshooting, and running the API on the host with hot reload:
[docs/local-development.md](./docs/local-development.md).

---

## Testing

Different layers prove different things, and none of them substitutes for
another.

```bash
# The SFU: real Pion peers, real ICE/DTLS/SRTP, real RTP forwarding.
cd services/sfu && go test -race ./...

# Scale: 2 / 10 / 50 / 100 participants, plus a 20-way mesh.
cd services/sfu && go test ./internal/room/ -run TestScale -v

# Unit tests, per package.
pnpm test                                  # apps/api
pnpm --filter @corvidhq/rtc test           # and any other package

# End-to-end. Needs a scratch Postgres — the suite refuses to run
# against a shared database — plus Chromium for the browser suites.
pnpm --filter @raven/api exec playwright install chromium
docker run --rm -d --name raven-e2e-db -p 5455:5432 \
  -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=raven postgres:16-alpine
E2E_DB="postgresql://postgres:scratch@localhost:5455/raven"
DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" pnpm --filter @raven/api prisma:migrate:deploy
DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" pnpm test:e2e
```

The e2e suite builds and runs a **real SFU** as a child process, and two of
its suites drive **real Chromium** through publish, subscribe and decode.
That matters: browser-behaviour bugs are invisible to every other layer.

What is and is not tested — including the network conditions that have
**never** been exercised — is stated plainly in
[docs/rtc/test-matrix.md](./docs/rtc/test-matrix.md).

---

## Documentation

Grouped by what you are trying to do.

**Build something**
[Browser SDK](./docs/sdk.md) ·
[React](./docs/sdk/react.md) ·
[Chat](./docs/sdk/chat.md) ·
[React Native](./docs/sdk/react-native.md) ·
[Flutter](./docs/sdk/flutter.md) ·
[TypeScript backend](./docs/sdk/server/typescript.md) ·
[Python backend](./docs/sdk/server/python.md) ·
[CLI](./docs/cli.md)

**Understand the RTC plane**
[Start here](./docs/rtc/README.md) ·
[Architecture](./docs/rtc/architecture.md) ·
[Signaling protocol](./docs/rtc/signaling.md) ·
[SFU](./docs/rtc/sfu.md) ·
[Networking & TURN](./docs/rtc/networking.md) ·
[Scaling](./docs/rtc/scaling.md) ·
[Security](./docs/rtc/security.md) ·
[Test matrix](./docs/rtc/test-matrix.md)

**Understand chat**
[Overview](./docs/chat/overview.md) ·
[Architecture](./docs/chat/architecture.md) ·
[WebSocket protocol](./docs/chat/websocket.md) ·
[Messages](./docs/chat/messages.md) ·
[Presence](./docs/chat/presence.md) ·
[Typing](./docs/chat/typing.md) ·
[Read receipts](./docs/chat/read-receipts.md) ·
[Reactions](./docs/chat/reactions.md) ·
[Threads](./docs/chat/threads.md) ·
[Attachments](./docs/chat/attachments.md) ·
[Webhooks](./docs/chat/webhooks.md)

**Operate it**
[Local development](./docs/local-development.md) ·
[Control plane](./docs/control-plane.md) ·
[coturn reference](./docs/turn.md) ·
[Observability](./docs/observability.md) ·
[Telemetry](./docs/telemetry.md) ·
[Diagnostics](./docs/diagnostics.md) ·
[Error codes](./docs/error-codes.md) ·
[Dashboard](./docs/dashboard.md) ·
[Production deployment](./docs/deployment/production.md)

**Decisions and history**
[Infrastructure decisions](./docs/architecture/infrastructure-decisions.md) ·
[WebRTC primer](./docs/architecture/webrtc.md) ·
[Native RTC migration map](./docs/architecture/native-rtc-migration-map.md) ·
[Migrating from LiveKit](./docs/migration/from-livekit.md)

**Examples**
[`examples/`](./examples) — a runnable app per path: plain JS, React,
React Native, Flutter, chat-only, video + chat, Node backend, Python
backend, and a CLI walkthrough.

---

## Status

Working, end to end, and verified against a live stack:

- Control plane — auth, projects, API keys, rooms, RTC tokens, audit logs
- Signaling and Raven's own SFU, with simulcast and RTCP recovery
- TURN/STUN via coturn, with per-token ephemeral credentials
- Browser, React, chat, effects, React Native and Flutter SDKs
- TypeScript and Python backend SDKs
- Dashboard, CLI, observability, webhooks
- Chat: durable messages, presence, typing, read receipts, reactions,
  threads, attachments
- Live streaming (host/viewer credentials, stream lifecycle)

**Not built, or built but unverified** — stated here rather than left to
be discovered:

- **Congestion control.** The SFU collects TWCC feedback but nothing
  consumes it to drive simulcast layer selection yet. A subscriber on a
  degrading connection sees loss rather than a lower layer.
- **Server-side quality verdict.** `getConnectionQuality()` returns
  `'unknown'` rather than a client-side guess in a server's clothing.
  `getConnectionStats()` returns real measured per-track numbers.
- **Simulcast on AV1 / H.265.** Keyframe detection covers VP8, VP9 and
  H.264; a layer switch cannot complete without it. Single-layer tracks in
  those codecs are fine.
- **Relay-only NAT traversal is untested.** Implemented and configured,
  but no test has ever forced media through coturn. This is the largest
  untested surface in the stack.
- **Only Chromium has been exercised with real media.** Firefox, Safari
  and Edge are untested. Support is feature-detected, so an untested
  browser reports supported — that is a claim about capabilities, not
  about interop.
- **No measured capacity figure.** Scale is verified to 100 participants
  on loopback with synthetic media; that is not a capacity number and is
  not quoted as one.
- No recording, and no usage metering or billing.

Details and current status for each:
[docs/rtc/test-matrix.md](./docs/rtc/test-matrix.md) and
[the capability matrix](./docs/architecture/native-rtc-migration-map.md#5-capability-matrix).
