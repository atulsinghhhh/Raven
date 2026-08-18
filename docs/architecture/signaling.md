# Signaling

> **Amended in Phase 3.** This document's original decision — no custom
> signaling server, LiveKit owns it entirely — has been superseded by an
> explicit, detailed Phase 3 specification that called for exactly the
> custom WebSocket signaling layer this ADR argued against. That layer
> now exists: `apps/api/src/modules/signaling/`, documented in
> `docs/signaling.md` and `docs/signaling-protocol.md`. The reasoning
> below is kept for history and because it's still *correct* for the
> LiveKit/SFU-mediated path — Phase 4 has to decide how the two coexist.
> Read `docs/signaling.md#why-this-exists-alongside-livekit` first.

## What signaling is

Signaling is the out-of-band exchange of connection metadata — SDP offers/
answers, ICE candidates, and application-level events (join, leave,
participant-joined, track-published) — needed to establish a WebRTC
session. **Signaling never carries audio/video/data itself.**

## Decision: LiveKit owns signaling; our control plane owns authorization

`INFRASTRUCTURE_PHASES.md` originally scoped "Signaling" (Phase 3) as a
custom WebSocket server we'd build ourselves, separate from "SFU"
(Phase 4). That scoping assumed an SFU toolkit like mediasoup that has no
signaling layer of its own.

Having chosen **LiveKit** (`sfu-comparison.md`), this changes: LiveKit ships
its own signaling protocol over WebSocket, built into its client and server
SDKs. Reimplementing a parallel signaling server would mean maintaining a
second, redundant SDP/ICE relay for no benefit — directly against
Rule 2 (do not build WebRTC from scratch) and Rule 3 (start simple).

**What this means concretely:**

- Phases 3 and 4 from the original roadmap collapse into a single
  integration phase: our SDK talks to LiveKit's signaling endpoint
  directly, authenticated by a LiveKit access token.
- Our control plane's job in this flow is entirely pre-signaling: decide
  *whether* a given caller is allowed to join a given room, with what
  permissions (publish / subscribe / admin), and issue a short-lived,
  scoped LiveKit access token (JWT) that encodes that decision.
- Once the SDK has that token, it hands the token to the LiveKit client
  SDK, which performs the actual signaling, ICE negotiation, and media
  session setup. Our servers are not in that data path.

```
Client SDK
   |
   | 1. POST /v1/tokens  (our control plane — auth + room/participant checks)
   v
Control Plane -----> issues LiveKit JWT (scoped: room, identity, canPublish, canSubscribe)
   |
   | 2. connect(wsUrl, token)  — LiveKit's own signaling protocol
   v
LiveKit signaling  — SDP offer/answer + ICE candidates exchanged here
   |
   v
LiveKit SFU
```

## What we still build

- The **Token Service** (Phase 2): validates the caller's API key/project,
  checks room-level permissions, and calls LiveKit's server SDK to mint an
  access token with the right grants and TTL.
- **Room lifecycle bookkeeping** (Phase 2): our Room model in Postgres is
  the source of truth for *our* metadata (which project owns a room, its
  settings, its recording state) — LiveKit's own room object is the source
  of truth for *live* participant/track state during a session. We
  reconcile the two via LiveKit's webhooks (participant joined/left, track
  published, room finished), not by re-implementing signaling.
- **Webhooks consumption**: LiveKit emits server-side webhooks for
  room/participant/track lifecycle events. Our Usage Service (Phase 8)
  and Room Service subscribe to these as the authoritative, server-derived
  source of usage data — never trusting client-reported state, consistent
  with the Phase 8 rule in `INFRASTRUCTURE_PHASES.md`.

## Definition of done for this document

Any engineer reading this can explain why there is no custom
`services/signaling` WebSocket server in this repository, what replaced
it, and where room/participant authorization actually happens.
