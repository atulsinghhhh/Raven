# Livqeno

**[ravenstack.online](https://ravenstack.online)** — live deployment ·
[dashboard](https://app.ravenstack.online) ·
[docs](https://docs.ravenstack.online) ·
API at `https://api.ravenstack.online`

**Managed real-time infrastructure for developers.** Add video, voice,
chat and live streaming to your own app — without running WebRTC or
WebSocket infrastructure yourself.

Livqeno is infrastructure, not a video-calling app: you get an API, SDKs and
a dashboard, and you build the product. Raven operates the control plane,
signaling and media plane; you never deploy or manage any of it.

```
Your backend  ──API key──▶  Livqeno Control API  ──▶ short-lived token
                                                        │
Your frontend ◀─────────────────────────────────────────┘
      │
      └──token──▶  Livqeno Signaling ──▶ Livqeno SFU ──▶ other participants
```

- **Node.js ≥ 20** (or Python) in your own backend, and any modern frontend.
- Everything speaks standards-compliant WebRTC — ICE, DTLS-SRTP, RTP/RTCP.
- No infrastructure to provision: no SFU, no TURN server, no Redis, no
  Postgres. Raven Cloud runs all of it.

---

## Quickstart

Three steps. Nothing here needs the dashboard, and no code touches SDP,
ICE or `RTCPeerConnection`.

### 1. Your backend mints a token

Never mint one in a browser: the API key is permanent, the token is not.

```bash
npm install @ravenkash/server        # Python: see the note below — not on PyPI yet
```

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL!, // https://api.ravenstack.online
});

// One route in YOUR app. The browser calls this; it never calls Livqeno.
app.post('/api/raven/grant', requireYourOwnAuth, async (req, res) => {
  const room = await raven.rooms.create({ name: `room-${req.user.orgId}` });

  // Identity comes from YOUR session — never from the request body.
  const grant = await raven.tokens.create({ room: room.id, identity: req.user.id });

  // grant = { token, endpoint, iceServers, telemetryUrl, roomId, roomName, expiresAt, ... }
  // Safe to return whole: the token is short-lived and its permissions are
  // signed in. The API key is not in here and must never be sent.
  res.json(grant);
});
```

### 2. Your frontend joins

```bash
npm install @ravenkash/rtc
```

`grant` is not a global — it crosses the wire. The browser fetches it from
the route you just wrote, then forwards it untouched:

```ts
import { createRTCClient } from '@ravenkash/rtc';

// Your own endpoint, your own session cookie. Livqeno is not called from here.
const grant = await fetch('/api/raven/grant', { method: 'POST' }).then((r) => r.json());

// Forward the whole grant. It already carries the endpoint, the ICE servers,
// the telemetry URL and the room, so there is nothing to configure:
const client = createRTCClient(grant);
const room = await client.join();

// The explicit form, if you prefer to see the fields. Note it drops
// telemetryUrl, so prefer passing `grant` above unless you have a reason:
//   const client = createRTCClient({
//     token: grant.token,
//     endpoint: grant.endpoint,       // Livqeno's signaling WebSocket
//     iceServers: grant.iceServers,   // never hand-build STUN/TURN config
//   });
//   const room = await client.join(grant.roomId);

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
npm install @ravenkash/rtc @ravenkash/react
```

```tsx
'use client';
import { RavenRoom, useConnectionState, useCamera, useLocalParticipant, ParticipantView } from '@ravenkash/react';

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
| `@ravenkash/rtc` | `npm i @ravenkash/rtc` | Browser RTC: join, publish, subscribe | [docs/sdk.md](./docs/sdk.md) |
| `@ravenkash/react` | `npm i @ravenkash/react` | Hooks + optional components for RTC **and** chat | [docs/sdk/react.md](./docs/sdk/react.md) |
| `@ravenkash/chat` | `npm i @ravenkash/chat` | Messaging: durable, ordered, with presence and typing | [docs/sdk/chat.md](./docs/sdk/chat.md) |
| `@ravenkash/effects` | `npm i @ravenkash/effects` | Camera effects pipeline (filters, presets) | [apps/docs/content/effects.md](./apps/docs/content/effects.md) |
| `@ravenkash/react-native` | `npm i @ravenkash/react-native` | iOS + Android, reusing `@ravenkash/rtc` unmodified | [docs/sdk/react-native.md](./docs/sdk/react-native.md) |
| `raven_rtc`, `raven_chat` | Dart / pub | Flutter, same concepts in idiomatic Dart | [docs/sdk/flutter.md](./docs/sdk/flutter.md) |

### Backend SDKs

| Package | Install | Reference |
|---|---|---|
| `@ravenkash/server` | `npm i @ravenkash/server` | [docs/sdk/server/typescript.md](./docs/sdk/server/typescript.md) |
| `livqeno-sdk` (Python) | coming soon to PyPI — [contact support](mailto:support@mail.ravenstack.online) for early access | [docs/sdk/server/python.md](./docs/sdk/server/python.md) |

Both hold a permanent project API key that never reaches a browser, mint
short-lived RTC and chat tokens, and read rooms, connections, errors and
diagnostics. Security model: [docs/security/server-sdk.md](./docs/security/server-sdk.md).

### Tools

| Tool | What it is | Reference |
|---|---|---|
| Dashboard (`apps/dashboard`) | Projects, API keys, rooms, participants, the SFU fleet, diagnostics | [docs/dashboard.md](./docs/dashboard.md) |
| `@ravenkash/cli` | `raven login`, `raven projects create`, `raven init`, `raven rtc servers list` | [docs/cli.md](./docs/cli.md) |

---

## How it fits together

Livqeno has **two planes, and they fail independently.**

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
services/
  sfu/                The SFU. Go, Pion. The only place media is touched.
packages/
  sdk/                @ravenkash/rtc          — browser RTC
  react-sdk/          @ravenkash/react        — hooks + components
  chat-sdk/           @ravenkash/chat         — messaging
  effects/            @ravenkash/effects      — camera effects
  react-native-sdk/   @ravenkash/react-native — iOS/Android
  server-sdk/         @ravenkash/server       — backend, TypeScript
  client/             @ravenkash/client       — live-streaming client
  cli/                @ravenkash/cli          — terminal workflow
sdks/
  flutter/            raven_rtc, raven_chat, raven_live
  python/             livqeno-sdk
examples/             Runnable apps, one per integration path
infrastructure/       docker/ · k8s/ · azure/
docs/                 Architecture, references, operations
scripts/              Load tests, infra verification, TURN certs
```

---

## Working on Raven itself

Raven is a hosted platform — integrating with it never requires running its
backend, SFU, TURN server, Redis or Postgres yourself (see Quickstart above).

The instructions for standing up the full stack locally are for **Raven's
own engineering team**, not for integrating with Raven: see
[docs/local-development.md](./docs/local-development.md) (internal).

---

## Testing Raven's own infrastructure

How Raven's engineering team runs the SFU, unit and end-to-end suites is
internal engineering process, not part of integrating with the platform —
see [CONTRIBUTING.md](./CONTRIBUTING.md) and
[docs/rtc/test-matrix.md](./docs/rtc/test-matrix.md) for what is and is not
exercised.

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

**Reference**
[Error codes](./docs/error-codes.md) ·
[Dashboard](./docs/dashboard.md)

**Working on Raven itself** (internal engineering — not required to integrate)
[Contributing guide](./CONTRIBUTING.md) ·
[Security policy](./SECURITY.md) ·
[Development](./docs/development.md)

**Examples**
[`examples/`](./examples) — a runnable app per path: plain JS, React,
React Native, Flutter, chat-only, video + chat, Node backend, Python
backend, and a CLI walkthrough.

---

## Status

Working, end to end, and verified against a live stack:

- Control plane — auth, projects, API keys, rooms, RTC tokens, audit logs
- Signaling and Livqeno's own SFU, with simulcast and RTCP recovery
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
