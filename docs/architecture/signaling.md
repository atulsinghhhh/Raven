# Signaling

> **Decision record — this decision was reversed, twice.** Read the
> current contract at [`../rtc/signaling.md`](../rtc/signaling.md); read
> this only for how the question was reasoned about.
>
> **First amendment (Phase 3).** The original decision below — no custom
> signaling server, the media server owns it entirely — was overruled by a
> specification calling for exactly the custom WebSocket layer this
> document argued against. Both then existed side by side: Raven's own
> WebSocket relayed SDP and ICE between browsers in a full mesh, while the
> SFU-mediated path used the vendor's protocol.
>
> **Second amendment (the native migration).** That split is gone. Raven
> owns the signaling protocol outright, and it is SFU-oriented: a client
> has exactly one peer — the node serving its room — so the server is a
> party to the negotiation rather than a courier, and no message names a
> `targetParticipantId`. See
> [`../migration/from-livekit.md`](../migration/from-livekit.md).
>
> The argument below is worth keeping for one reason: it was **right about
> the trade-off and wrong about the price**. Reimplementing a signaling
> protocol *is* redundant work with no benefit — right up until you want
> to change the media plane underneath it, at which point owning the
> protocol is the only thing that makes that possible without an SDK
> release. That is the cost this document did not price, and the migration
> is what paid it.

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
