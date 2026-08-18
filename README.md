# Raven

Open-source, developer-first real-time communication infrastructure.
Raven lets a developer add real-time video, voice, and data to their own
application — create a project, create a room, generate a token, join,
publish — without operating WebRTC infrastructure themselves.

Raven is infrastructure, not a video-calling app. Category peers: LiveKit
Cloud, Daily, Agora. See `docs/architecture/` for the technical
architecture decisions.

## Status

**Phase 11 of 19** — control plane, signaling, real WebRTC media (LiveKit +
coturn), a production-oriented TURN/NAT-traversal setup, a TypeScript
browser SDK (`@raven/rtc`), React hooks/components on top of it
(`@raven/react`), a developer dashboard (`apps/dashboard`), a terminal
CLI (`@raven/cli`), a first observability/diagnostics layer, and official
backend SDKs for TypeScript (`@raven/server`) and Python (`raven-sdk`)
are all working end to end and verified live. No recording, usage
metering/billing, or a mobile/Go/Java/etc. SDK yet.

## Architecture at a glance

- **Control plane** (`apps/api`, Phase 2): auth, projects, API keys,
  rooms, RTC tokens (now including TURN `iceServers`) — NestJS modular
  monolith, PostgreSQL (Prisma), Redis.
- **Signaling** (`apps/api`, Phase 3): a raw WebSocket gateway at
  `/v1/rtc` — authentication, room join/leave, participant presence,
  SDP offer/answer and ICE candidate routing. Metadata only, never media.
  Not used for the media path itself — see `docs/sfu.md`.
- **RTC plane** (Phase 0/1/4/5): [LiveKit](https://livekit.io) as the SFU
  and signaling layer for real media, [coturn](https://github.com/coturn/coturn)
  for TURN/STUN, with time-limited credentials issued per RTC token and a
  documented production NAT-traversal setup.
- **Browser SDK** (`packages/sdk`, Phase 6): `@raven/rtc` — join a room,
  publish camera/microphone, subscribe to remote media, without ever
  touching SDP, ICE, or `RTCPeerConnection` directly.
- **React SDK** (`packages/react-sdk`, Phase 11): `@raven/react` — hooks
  (`useRaven`, `useConnectionState`, `useParticipants`, `useCamera`, ...)
  and optional components (`RavenRoom`, `ParticipantView`, ...) on top of
  `@raven/rtc`, which itself was not changed to build this — headless by
  default, no UI lock-in.
- **Dashboard** (`apps/dashboard`, Phase 7): create an account, manage
  projects and API keys, inspect rooms and their live LiveKit participant
  state, and read SDK integration instructions — a thin, server-rendered
  UI over the same Control API, never a second source of truth.
- **CLI** (`packages/cli`, Phase 8): `@raven/cli` — `raven login`,
  `raven projects create`, `raven init`, `raven dev` — a terminal
  workflow tool over the same Control API, with browser-based auth (no
  password paste) and no direct access to the database, Redis, LiveKit,
  or coturn.
- **Observability** (`apps/api`, Phase 9): best-effort telemetry from
  `@raven/rtc` (never blocking, never able to break an RTC connection)
  event-sources a real `Connection`/`ErrorEvent` history, classified into
  Raven-facing categories (`TOKEN_ERROR`, `ICE_ERROR`, `TURN_ERROR`, ...)
  — surfaced in the dashboard's Connections/Errors tabs and via `raven
  connections`/`raven errors`/`raven diagnostics`.
- **Server SDKs** (`packages/server-sdk`, `sdks/python`, Phase 10):
  `@raven/server` and `raven-sdk` — mint short-lived RTC tokens and read
  rooms/connections/errors/metrics/diagnostics from your own backend
  using a permanent project API key, which never reaches a browser. Same
  Control API every other client uses, no new endpoints invented beyond
  a couple of small API-key-guarded mirrors of existing dashboard reads.

Full rationale: `docs/architecture/infrastructure-decisions.md`,
`docs/control-plane.md`, `docs/signaling.md`, `docs/sfu.md`,
`docs/media-flow.md`, `docs/turn.md`, `docs/nat-traversal.md`,
`docs/sdk.md`, `docs/dashboard.md`, `docs/cli.md`, `docs/observability.md`,
`docs/telemetry.md`, `docs/diagnostics.md`, `docs/error-codes.md`,
`docs/sdk/server/typescript.md`, `docs/sdk/server/python.md`,
`docs/security/server-sdk.md`, `docs/sdk/web.md`, and `docs/sdk/react.md`.

## Local development

```bash
cp .env.example .env      # then fill in real local secrets
pnpm infra:up              # start Postgres, Redis, LiveKit, coturn, api
pnpm infra:verify          # confirm everything is healthy
pnpm db:seed               # optional: demo developer + project + API key + room
```

Interactive API docs: http://localhost:4100/docs. Full instructions,
ports, and troubleshooting: `docs/local-development.md`.

To also run the dashboard locally:

```bash
pnpm --filter @raven/dashboard build
pnpm --filter @raven/dashboard start   # http://localhost:3000
```

## Dashboard → Quickstart → SDK

The intended developer path through this repo:

1. **Dashboard** (`apps/dashboard`) — register, create a project, create an
   API key.
2. **Quickstart tab** (in the dashboard, per-project) — copy the exact
   install command and code for your backend (token minting) and frontend
   (join/publish/subscribe), matching the real `@raven/rtc` API.
3. **SDK** (`packages/sdk`, `@raven/rtc`) — the browser package those
   snippets use. Full reference: `docs/sdk.md`.

See `docs/dashboard.md` for the dashboard's own architecture,
authentication/authorization model, and security notes.

## Raven CLI

```bash
raven login                       # browser-based auth, no password paste
raven projects create my-video-app
raven init                        # link this directory (writes raven.json)
raven sdk install                 # installs @raven/rtc via your package manager
raven dev                         # confirms this directory is ready for RTC development
```

`raven` talks only to the Control API (never the database, Redis,
LiveKit, or coturn directly) and mirrors the dashboard's own security
model — API key secrets are shown exactly once, and the only thing it
stores permanently on disk is a session token under `~/.raven/`
(`600`/`700` permissions). Full reference: `docs/cli.md`. Canonical
walkthrough: `examples/cli-workflow.md`.

## Backend SDKs

```bash
npm install @raven/server      # TypeScript / Node.js
pip install raven-sdk          # Python
```

```ts
import { Raven } from '@raven/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY! });
const token = await raven.tokens.create({ room: roomId, identity: 'user-42' });
// hand `token` straight to your frontend — never mint one in the browser
```

```python
from raven import Raven, CreateTokenParams

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])
token = raven.tokens.create(CreateTokenParams(room=room_id, identity="user-42"))
```

Both wrap the same Control API every other client (dashboard, CLI,
`@raven/rtc`) uses — a permanent API key that never reaches a browser,
short-lived RTC tokens, and read access to rooms/connections/errors/
metrics/diagnostics. Full reference: `docs/sdk/server/typescript.md`,
`docs/sdk/server/python.md`, security model: `docs/security/server-sdk.md`.
Runnable examples: `examples/node-server/`, `examples/python-server/`.

## React SDK

```bash
npm install @raven/rtc @raven/react
```

```tsx
'use client';
import { RavenRoom, useConnectionState, useCamera, ParticipantView, useLocalParticipant } from '@raven/react';

function CallPage({ token, endpoint, room }) {
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

Headless hooks (`useRaven`, `useConnectionState`, `useParticipants`,
`useCamera`, `useMicrophone`, ...) plus optional components
(`RavenRoom`, `ParticipantView`, `RavenVideo`, `RavenAudio`) — nothing
required beyond the hooks if you'd rather build your own UI. `@raven/rtc`
itself is unchanged (see `docs/sdk/web.md` for the small, additive gaps
Phase 11 closed). Full reference: `docs/sdk/react.md`. Runnable example:
`examples/react-video-call/`.

## Documentation

- `docs/architecture/` — Phase 0 architecture decisions (WebRTC
  fundamentals, SFU comparison, TURN, signaling)
- `docs/local-development.md` — Phase 1 local infrastructure setup
- `docs/control-plane.md` — Phase 2 API design (auth model, data model,
  RTC token permission mapping)
- `docs/signaling.md` / `docs/signaling-protocol.md` — Phase 3 WebSocket
  signaling layer and wire protocol
- `docs/sfu.md` / `docs/media-flow.md` — Phase 4 SFU integration, TURN,
  and why media never touches the API or signaling server
- `docs/turn.md` / `docs/nat-traversal.md` — Phase 5 STUN/TURN reliability,
  production NAT-traversal checklist, and known local-environment limits
- `docs/sdk.md` — Phase 6 browser SDK (`@raven/rtc`) API reference
- `docs/dashboard.md` — Phase 7 dashboard architecture, auth/authorization,
  and security audit notes
- `docs/cli.md` — Phase 8 CLI reference: authentication, config storage,
  commands, JSON output, exit codes, and security notes
- `docs/observability.md` — Phase 9 architecture, data model, metrics,
  retention, and privacy
- `docs/telemetry.md` — Phase 9 what `@raven/rtc` reports and how
  (best-effort, never blocking RTC)
- `docs/diagnostics.md` — Phase 9 the two diagnostic surfaces (server-side
  project diagnostics vs. client-side `room.getDiagnostics()`)
- `docs/error-codes.md` — Phase 9 error categories and their explanations
- `docs/sdk/server/typescript.md` — Phase 10 `@raven/server` reference
- `docs/sdk/server/python.md` — Phase 10 `raven-sdk` (Python) reference
- `docs/security/server-sdk.md` — Phase 10 server SDK security model
  (API key storage, authorization model, short-lived tokens)
- `docs/sdk/web.md` — Phase 11 `@raven/rtc` additions (browser support,
  Next.js usage) — see `docs/sdk.md` for the full API, unchanged
- `docs/sdk/react.md` — Phase 11 `@raven/react` reference: hooks,
  optional components, Next.js, Strict Mode
- `examples/signaling-demo/` — minimal two-tab browser demo of the
  signaling layer (no build step, no media)
- `examples/media-demo/` — minimal two-tab browser demo of real
  camera/microphone media through LiveKit (no build step)
- `examples/video-call/` — minimal two-tab browser demo built entirely on
  `@raven/rtc`'s public API (no raw WebRTC types)
- `examples/cli-workflow.md` — the canonical `raven login` →
  `projects create` → `init` → `sdk install` → `dev` flow
- `examples/node-server/` — Express backend minting RTC tokens with
  `@raven/server`
- `examples/python-server/` — FastAPI backend minting RTC tokens with
  `raven-sdk`
- `examples/react-video-call/` — real, buildable React app (Vite) using
  `@raven/react`'s hooks and components — camera/mic/screen-share/device
  selection/participants/leave/reconnect status
