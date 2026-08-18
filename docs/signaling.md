# Signaling (Phase 3)

This document covers the WebSocket signaling layer built in Phase 3 of
`INFRASTRUCTURE_PHASES.md`: `apps/api/src/modules/signaling/`. It lets
clients authenticate, join a room, exchange SDP/ICE, and track
participant presence. **It carries connection metadata only — never
audio or video.** Actual media flows through the RTC plane (LiveKit +
coturn, Phase 0/1); that stays true regardless of anything in this
document.

## Why this exists alongside LiveKit

This is worth being explicit about, because it's a real tension with an
earlier decision. `docs/architecture/signaling.md` (the Phase 0 ADR)
concluded that a separate custom signaling server would be redundant,
since LiveKit ships its own signaling protocol — and that conclusion
was correct for the LiveKit/SFU-mediated path. Phase 3 was specified in
detail as a genuinely custom, general-purpose WebSocket signaling layer:
room/participant state, SDP offer/answer routing, and ICE candidate
routing between clients directly, independent of LiveKit's own protocol.
That's what's built here.

Concretely, there are now two signaling paths that will need to be
reconciled in Phase 4:

1. **This layer** — generic room/participant/SDP/ICE routing, useful for
   direct peer-to-peer topologies (e.g. 1:1 calls) or as the foundation
   for a custom media path.
2. **LiveKit's own signaling** — used whenever the client connects
   directly to LiveKit with the access token from Phase 2, for SFU-routed
   group calls.

Phase 4 has to decide, per use case, which path a client actually uses to
reach the SFU — this is flagged there as an open design question, not
resolved here. See `docs/architecture/signaling.md` for the amended note.

## Architecture

```
Client A                                          Client B
   |                                                  |
   | WebSocket (wss://.../v1/rtc?token=<RTC token>)   |
   v                                                  v
        SignalingGateway (apps/api, same HTTP server/port as the REST API)
                              |
                    RtcTokenVerifierService   <- verifies the same LiveKit-format
                              |                  JWT Phase 2 mints, no new token type
                    MessageValidatorService   <- rejects malformed/oversized/unknown messages
                              |
                    MessageRouterService      <- authorization + routing, never touches SDP content
                              |
                    RoomRegistryService       <- in-memory room/participant state (this instance only)
```

The control plane (Phase 2) and this signaling layer share one process
and one Postgres/Redis, but own genuinely different state: Postgres holds
durable resources (rooms, API keys, RTC token *records*); this layer
holds transient, in-memory presence (who's actually connected right now).
Nothing here is written to Postgres, per the Phase 3 instruction not to
duplicate transient state there.

## WebSocket connection

```
wss://<api-host>/v1/rtc?token=<RTC token>
```

Locally: `ws://localhost:4100/v1/rtc?token=...`. The token is passed as a
query parameter, not a header — this is deliberate: a browser's native
`WebSocket` constructor cannot set custom headers (no `Authorization`
header is possible on the handshake), so a query parameter is the
standard, pragmatic choice for WebSocket auth (LiveKit's own client SDK
does the same with `access_token`).

**The RTC token is the same LiveKit-format JWT Phase 2's
`POST /v1/rooms/:roomId/rtc-tokens` already mints** — there is no separate
signaling-specific token format. To make that token also carry enough
context for this layer to bind a connection to exactly one project/room
without an extra database round trip, `RtcTokensService` (Phase 2) was
extended to add two custom LiveKit token *attributes*:
`ravenProjectId` and `ravenRoomId`. This is the one small retrofit to
already-shipped Phase 2 code; everything else there is unchanged, and its
own test suite (`app.e2e-spec.ts`) still passes unmodified apart from
one assertion that had to account for a new field on `GET /health` (see
below).

## Authentication flow

```
Connect (WS upgrade, ?token=...)
   |
   v
Connection-level rate limit check (Redis, per client IP)
   |
   v
Verify JWT signature + expiry + issuer (TokenVerifier, same LIVEKIT_API_SECRET)
   |
   v
Extract participantId (sub), roomId/projectId (attributes), permissions (video grant)
   |
   v
Create in-memory ParticipantSession (not yet visible to other participants)
```

A connection that fails any of these steps receives one `error` frame
(see Error Protocol below) and is closed with a 4000-series close code —
never a bare disconnect with no explanation. The signed token is the sole
source of authorization: nothing the client asserts independently (e.g.
a `roomId` in a later `room.join` message) is trusted over what's in the
token; a disagreement is rejected (`UNAUTHORIZED`), not merged or
overridden.

## Room lifecycle

Authentication happens at connect time, but a connection isn't visible to
other participants — and doesn't appear in room state — until it
explicitly sends `room.join`:

```
CONNECT -> AUTHENTICATE (automatic, at connect) -> [idle, authenticated but not joined]
   |
   v  client sends {"type":"room.join"}
JOIN (join permission checked; roomId, if given, must match the token)
   |
   v
CONNECTED / MESSAGING (room.leave, sdp.offer/answer, ice.candidate, ping)
   |
   v
LEAVE (explicit room.leave) or DISCONNECT (close/terminate, incl. abrupt)
```

Both explicit `room.leave` and an abrupt disconnect run the exact same
cleanup path: remove the participant from `RoomRegistryService`, notify
the remaining participants with `participant.left`, and release the
session. There is no way to end up with a participant that's connected in
memory but invisible to the room, or visible in the room but no longer
connected.

### Reconnection

A participant's identity is their RTC token's `sub` claim (their
`participantId`), never their WebSocket connection itself. If a second
connection authenticates with the same `participantId` and sends
`room.join` while the first is still technically open, the **first
connection is closed** (an `error` frame with `UNAUTHORIZED`, then close
code `4002`) and replaced. This is what makes reconnection safe: a client
that drops and reconnects (new WebSocket, fresh or cached RTC token) just
works, without the server ever holding two live sessions for one logical
participant.

## SDP and ICE routing

Both are pure forwarding — the signaling layer never parses, modifies, or
understands SDP content or ICE candidate contents. Every route (`sdp.offer`,
`sdp.answer`, `ice.candidate`) does the same three checks before
forwarding:

1. Sender has actually joined a room (`NOT_IN_ROOM` otherwise).
2. Sender isn't targeting themselves (`INVALID_MESSAGE`).
3. The target participant exists **in the sender's own room** — the
   lookup is scoped to `session.roomId`, so a same-named participant in a
   different room is simply never found (`PARTICIPANT_NOT_FOUND`). There
   is no code path that can leak a candidate or SDP payload across rooms.

## Redis usage in this layer

Only the connection-level rate limit (`ConnectionRateLimitService`) uses
Redis here — the same fixed-window `INCR`+`EXPIRE` pattern as the HTTP
API's rate limiter (Phase 2). It's Redis-backed specifically because it
must survive reconnect attempts from the same IP across multiple
WebSocket handshakes, which an in-memory counter tied to one connection
object cannot do. The per-connection *message* rate limit is deliberately
in-memory instead (see below) — that state is meaningless outside the
single process holding the live socket, so there's nothing to share.

## Multi-instance readiness (not implemented)

`RoomRegistryService` is in-memory and correct for exactly one signaling
process. Running more than one instance would need participants of the
same room to be reachable regardless of which instance they connected
to — the standard solution is a Redis Pub/Sub channel per room (or a
shared channel with room-scoped messages) that each instance subscribes
to, republishing to its own locally-connected sockets. This is explicitly
**not built now**, per the instruction not to implement multi-instance
signaling before it's actually required — but the module boundaries
(`RoomRegistryService` as the single seam between "room state" and
"who's actually connected to me") are exactly where that Pub/Sub layer
would slot in later without touching the gateway, message validation, or
authorization logic at all.

## Rate limiting and abuse protection

| Limit | Mechanism | Default |
|---|---|---|
| Connection attempts per IP | Redis fixed window | 20 / 60s (`SIGNALING_MAX_CONNECTIONS_PER_WINDOW`) |
| Messages per connection | In-memory sliding window | 100 / 10s (`SIGNALING_MAX_MESSAGES_PER_WINDOW` / `SIGNALING_MESSAGE_WINDOW_SECONDS`) |
| Message size | Byte-length check before JSON parsing | 16 KiB (`SIGNALING_MAX_MESSAGE_BYTES`) |
| Participants per room | Checked in `RoomRegistryService.join` | 50 (`SIGNALING_MAX_PARTICIPANTS_PER_ROOM`) |

All are simple counters, not a distributed quota platform — consistent
with the Phase 2 HTTP rate limiter and the explicit instruction not to
over-build this now.

## Heartbeat

The gateway runs one `setInterval` (30s) that walks every live session:
if a session didn't respond to the *previous* ping (`isAlive` still
`false`), the socket is terminated and treated as a disconnect; otherwise
it's marked not-yet-confirmed and a WebSocket-protocol `ping` frame is
sent, with `isAlive` flipping back to `true` on the client's automatic
`pong` (browsers respond to protocol-level pings transparently — no
application code needed on the client for this half). Separately, the
wire protocol also supports an application-level `{"type":"ping"}` /
`{"type":"pong"}` message pair, because raw WebSocket protocol pings
aren't something client-side JavaScript can *send* (only receive) — the
app-level pair exists for a client that wants to actively verify
round-trip liveness itself, not just rely on the server's sweep.

## Security

- RTC tokens are verified with the same mechanism and secret as LiveKit
  itself (`TokenVerifier`, `LIVEKIT_API_SECRET`) — no parallel trust root.
- Every message is validated against a known shape before any handler
  runs it (see `docs/signaling-protocol.md`) — nothing is forwarded
  blindly.
- Errors returned to clients are a fixed vocabulary of codes with a safe,
  generic message — never a raw exception message or stack trace.
- Nothing security-sensitive is logged: no full tokens, no secrets. Log
  lines reference participant/room identifiers and error *codes*, not
  token contents.
- WSS/TLS in production is a deployment-layer concern (terminated at a
  load balancer/reverse proxy in front of this same HTTP server) — Phase
  3 doesn't add anything here beyond documenting that this must not be
  plain `ws://` outside local development.
- CORS (`docs/control-plane.md#cors`) governs HTTP; a WebSocket handshake
  is not subject to the browser CORS preflight the same way, so origin
  restriction for signaling connections, if needed later, would be
  enforced explicitly in the gateway (checking the `Origin` header) —
  not implemented in Phase 3, since nothing in the spec called for it and
  the local demo page relies on being origin-unrestricted.

## Implementation notes (things that weren't obvious going in)

- **NestJS's default WebSocket message binding doesn't fit this
  protocol.** `@SubscribeMessage()` expects `{"event": "...", "data": {...}}`
  frames; this protocol's `{"type": "..."}` flat shape doesn't match, so
  the gateway bypasses that binding layer entirely and parses/dispatches
  raw `message` events itself, while still using Nest's
  `handleConnection`/`handleDisconnect` lifecycle hooks normally.
- **`ws`, not Socket.IO.** `@nestjs/platform-ws` was used instead of the
  more commonly-documented `@nestjs/platform-socket.io`, specifically so
  a browser's native `WebSocket` API is the only thing a client ever
  needs — Socket.IO requires its own client library and adds its own
  framing on top of WebSocket.
- **A real race condition, caught by testing, not by inspection:** token
  verification is async (a Redis round trip plus JWT verification). A
  client that sends its first message immediately on `open` (a
  reasonable, common pattern) can have that frame arrive and be silently
  dropped if the server's `message` listener isn't attached yet —
  `EventEmitter` does not buffer events for listeners added later. Fixed
  by calling `client.pause()` synchronously as the very first thing in
  `handleConnection`, doing all async auth work, attaching the `message`/
  `pong` listeners, and only then calling `client.resume()`. This was
  found while manually smoke-testing the happy path, not from reading the
  code — worth remembering when touching connection setup again.

## Local testing

- **Automated:** `pnpm test:e2e` (from the repo root or `apps/api`) runs
  `test/signaling.e2e-spec.ts` — real WebSocket clients (the `ws`
  package) against the real running app and real Postgres/Redis. It
  covers authentication (valid/malformed/expired tokens, room mismatch),
  permissions, message validation, the full two-participant flow from
  Phase 3 §23 (connect → join → participant events → SDP offer/answer →
  ICE both directions → disconnect → `participant.left`), cross-room
  isolation, abrupt disconnect cleanup, and reconnection.
- **Manual / visual:** `examples/signaling-demo/index.html` — a
  dependency-free static page. Open it in two browser tabs, paste an RTC
  token in each (minted via `POST /v1/rooms/:roomId/rtc-tokens`, or from
  `pnpm db:seed`), and drive the whole protocol by hand. See
  `examples/signaling-demo/README.md`.

## What's still deferred

Per `INFRASTRUCTURE_PHASES.md`, Phase 3 stops at signaling. Not yet
built: actual SFU/media integration (Phase 4 — including reconciling this
layer with LiveKit's own signaling, see above), the TypeScript SDK
(Phase 6), multi-instance Redis Pub/Sub (only if/when a second instance
is actually needed), and TURN credential issuance tied to signaling
sessions (still coturn's job, per `docs/architecture/turn.md`, not
wired into this layer).
