# Raven RTC — Signaling protocol

The wire contract between a Raven client and the Raven API. One WebSocket
per client, JSON text frames, at `/v1/rtc`.

You do not need this to use Raven — the SDKs implement it. It is here for
anyone writing a client for a platform Raven does not ship, debugging a
connection, or reading the server.

> **This protocol is SFU-oriented, not peer-to-peer.** It replaced a
> full-mesh relay in which every SDP and ICE message named a
> `targetParticipantId`. A client now has exactly one peer — the SFU node
> serving its room — so messages need no target, and the server is a party
> to the negotiation rather than a courier. Several message *names*
> survived that change; their meaning did not.

Source of truth: `apps/api/src/modules/signaling/signaling.constants.ts`
and `interfaces/signaling-message.interface.ts`. The three client
implementations mirror it in
`packages/sdk/src/internal/signaling/protocol.ts`,
`sdks/flutter/raven_rtc/lib/src/internal/protocol.dart`, and (via the web
SDK) React Native.

---

## Connecting

```text
wss://your-api.example.com/v1/rtc?token=<rtc-token>
```

The token goes in a query parameter because a WebSocket handshake cannot
carry custom headers in a browser. It is short-lived by design for exactly
that reason, and the connection **must** be `wss://` in production —
which the server's own configuration validation enforces.

The connection is authenticated at upgrade. A rejected credential closes
with code **4001** after an `error` frame, which is the signal to refresh
the token rather than retry with the same one.

Rate limits apply per IP on the upgrade (Redis-backed, shared with the
HTTP API) and per connection on messages (in-memory sliding window). Both
are configurable; see `SIGNALING_*` in `.env.example`.

---

## Client → server

### `room.join`

```json
{ "type": "room.join", "roomId": "room_123", "region": "asia-south" }
```

Both fields optional. `roomId`, if present, **must match** the room the
token authorizes — the signed token is what grants access, and a field in
a message never overrides it. `region` is a preference: the allocator
falls back to another region rather than failing a call that could
otherwise happen.

Must be the first message. Everything else is rejected with `NOT_IN_ROOM`
until it succeeds.

### `sdp.answer`

```json
{ "type": "sdp.answer", "sdp": "v=0\r\n..." }
```

Answering the SFU's offer. The common case — the SFU offers first.

### `sdp.offer`

```json
{ "type": "sdp.offer", "sdp": "v=0\r\n..." }
```

A client-initiated offer, sent when the client starts publishing and no
transceiver exists yet for that kind. Requires the `publish` permission.

If the server already has an offer in flight this is refused with
`NEGOTIATION_GLARE` — **retryable**. Answer the server's offer, then send
this again.

### `ice.candidate`

```json
{
  "type": "ice.candidate",
  "candidate": "candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host",
  "sdpMid": "0",
  "sdpMLineIndex": 0,
  "usernameFragment": "abc123"
}
```

Only `candidate` is required; the rest are optional in WebRTC and a
browser may send any subset. Do **not** send an end-of-candidates signal —
the server treats the absence of further candidates the same way.

### `track.publish`

```json
{ "type": "track.publish", "trackId": "abc-123", "source": "screenShare" }
```

Declares what a track is *of*: `camera`, `microphone`, or `screenShare`.
Send it **before** negotiating the track, so the source is known by the
time media arrives.

This exists because WebRTC carries no notion of source and a page cannot
choose the stream or track id that reaches the SDP — so codec kind is all
the server could otherwise infer from, and that cannot tell a screen share
from a camera. An unrecognised source is rejected rather than defaulted: a
screen share rendered as somebody's face is a worse outcome than an error.

### `track.mute`

```json
{ "type": "track.mute", "trackId": "abc-123", "muted": true }
```

Mutes without unpublishing. The track and its transceivers stay, so
unmuting is immediate and subscribers keep the participant's tile.

### `subscription.update`

```json
{
  "type": "subscription.update",
  "publisherId": "bob",
  "trackId": "bob-cam",
  "layer": "low"
}
```

Requests a simulcast layer: `low`, `medium`, `high`, or `auto`. Requires
`subscribe`. An unrecognised layer is rejected rather than substituted —
silently giving a different quality would hide a client bug.

**No confirmation is sent.** The layer actually delivered depends on what
the publisher is sending, so a success reply would let a UI claim a
quality it may not be receiving. Read what you are getting from
`getConnectionStats()`.

### `ping`

```json
{ "type": "ping" }
```

Answered with `pong`. Not required — the server sends WebSocket-level
pings on a 30-second heartbeat and terminates a connection that misses a
cycle.

---

## Server → client

### `room.joined`

```json
{
  "type": "room.joined",
  "roomId": "room_123",
  "rtcServer": "sfu-asia-02",
  "region": "asia-south",
  "participants": [
    {
      "id": "bob",
      "tracks": [
        { "trackId": "bob-cam", "kind": "video", "source": "camera",
          "muted": false, "simulcast": true, "layers": ["low", "medium", "high"] }
      ]
    }
  ]
}
```

`participants` includes what each is **already publishing**, so a client
joining a call in progress can render the room in one pass rather than
filling an empty grid from a stream of events it must distinguish from
genuinely new ones.

`rtcServer` is the node's *name*, for support and diagnostics — never its
address. A client that learned an SFU's address could connect to it
directly, and then the media plane could not change without breaking that
client.

This is the end of the control-plane part of joining, not the end of
joining. The media connection completes after ICE and DTLS.

### `sdp.offer`

```json
{ "type": "sdp.offer", "sdp": "v=0\r\n..." }
```

The SFU's offer. Sent on join, and again whenever the room's track set
changes. **Answer it** with `sdp.answer`.

### `sdp.answer`

The SFU's answer to a client-initiated offer. Always carries
`a=setup:passive`.

That is a guarantee, not an accident. Because negotiation runs in both
directions on one peer connection, the DTLS role has to be identical
whichever side offered — it belongs to the transport and cannot change once
the handshake has run. **The client is always the DTLS client and the SFU is
always the DTLS server.** So the SFU offers `a=setup:actpass` (answer it
`active`) and answers `a=setup:passive`, and a client never has to reason
about the role at all.

Getting this wrong is not a subtle degradation. A client that answers the
SFU's join offer `active` and is then answered `active` when it publishes is
being asked to swap roles mid-session; Chrome rejects the SDP outright with
"Failed to set SSL role for the transport", and the publish never
negotiates.

### `ice.candidate`

Same shape as the client-to-server form. Apply it to the peer connection;
candidates that arrive before a remote description is set should be
buffered, as in any WebRTC client.

### `participant.joined` / `participant.left`

```json
{ "type": "participant.joined", "participant": { "id": "carol", "tracks": [] } }
```

### `track.published` / `track.unpublished`

```json
{
  "type": "track.published",
  "participantId": "bob",
  "track": { "trackId": "bob-screen", "kind": "video", "source": "screenShare",
             "muted": false, "simulcast": false }
}
```

Reports what a participant is **actually sending**, observed on the wire —
not what they said they would send. Not sent to the publisher, who already
knows.

`track.published` and the corresponding `ontrack` event race, and either
can arrive first. A client must handle both orders; the SDKs park whichever
arrives first and complete the subscription when the other lands.

### `track.muted` / `track.unmuted`

```json
{ "type": "track.muted", "participantId": "bob", "trackId": "bob-cam" }
```

Distinct from unpublish: nothing is renegotiated. Drive your muted
indicator from this rather than from `MediaStreamTrack.muted`, which in a
browser means "no data is arriving right now" and flickers during ordinary
network jitter.

### `connection.state`

```json
{ "type": "connection.state", "iceState": "connected", "peerState": "connected" }
```

ICE and DTLS state as the **SFU** observes it, in the stack's own
vocabulary. Worth having alongside your local state because the two can
disagree, and "the server says failed while the browser says connected" is
a diagnosis rather than a contradiction.

### `error`

```json
{ "type": "error", "code": "NEGOTIATION_GLARE", "message": "..." }
```

| Code | Retryable | Meaning |
|---|---|---|
| `INVALID_TOKEN` | No | Malformed, wrong signature, or wrong audience. |
| `TOKEN_EXPIRED` | With a new token | Refresh and reconnect. |
| `UNAUTHORIZED` | No | The token does not authorize this. |
| `PERMISSION_DENIED` | No | The grant does not include this action. |
| `ORIGIN_NOT_ALLOWED` | No | The page's `Origin` is not on the project's allow-list. The token was valid; the page holding it was not expected. Fixed in the dashboard under Project Settings, Security, Allowed Origins — not by retrying. CORS does not apply to a WebSocket upgrade, so this gateway checks `Origin` itself. |
| `ROOM_NOT_FOUND` | No | No such room in this project and environment. |
| `ROOM_FULL` | No | The room hit its participant limit. |
| `NOT_IN_ROOM` | After rejoining | An action was attempted before `room.join`, or the media session is gone. |
| `NO_RTC_CAPACITY` | Yes, later | No healthy RTC server had room. An operator problem. |
| `RTC_SERVER_UNREACHABLE` | Yes | The assigned node could not be reached. |
| `NEGOTIATION_GLARE` | **Yes** | An offer from the server is already in flight. Answer it, then retry. |
| `NEGOTIATION_FAILED` | After rejoining | Negotiation could not be completed. |
| `INVALID_MESSAGE`, `INVALID_MESSAGE_TYPE` | No | A client bug. |
| `RATE_LIMITED` | Yes, with backoff | Too many messages or connection attempts. |

Error messages are written for a developer. They never echo back
attacker-controlled input and never carry a stack trace or a native error
string.

---

## Close codes

Beyond the standard WebSocket codes (1000 normal, 1006 abnormal), this
protocol uses the application-reserved 4000–4999 range (RFC 6455 §7.4.2).
Source: `apps/api/src/modules/signaling/gateway/signaling.gateway.ts`.

| Code | Meaning | What a client should do |
|---|---|---|
| `4001` | Authentication failed at connect time | Read the preceding `error` frame for which. `INVALID_TOKEN` means stop; `TOKEN_EXPIRED` means refresh and reconnect. |
| `4002` | Replaced by a newer connection for the same participant identity | Nothing. Another tab or device took over; reconnecting would evict *it*, and two clients fighting over one identity is a loop. |
| `4029` | Connection-level rate limit exceeded | Back off before reconnecting. |

**An `error` frame is always sent before any of these**, so a client never
has to infer why it was disconnected from the code alone. The distinction
that matters most is `4001` versus a plain socket failure: one means the
credential is wrong, the other means the server was not reachable, and
retrying is right for exactly one of them.

---

## Versioning

This is v1, implicit in the `/v1/rtc` path and matching the rest of the
API's `/v1/` convention. A breaking change to message shapes or error
codes ships under `/v2/rtc` rather than silently changing this contract.

Additive changes — a new message type, a new field, a new error code — are
not breaking and will appear in v1. A client must therefore **ignore
message types and fields it does not recognise** rather than treat them as
errors; all three of Raven's own clients do.

Message *names* surviving a change of meaning is exactly what the mesh-to-
SFU migration did, and it is why that is called out at the top of this
document rather than left for a reader to discover. It is also why the
next such change gets a new path instead.

---

## A complete join, on the wire

```text
client                                              server
  │                                                    │
  ├── GET /v1/rtc?token=… ────────────────────────────► │  (upgrade)
  │                                                    │
  ├── { "type": "room.join" } ───────────────────────► │
  │                                                    │  verify token
  │                                                    │  allocate a node
  │                                                    │  ask it for a PeerConnection
  │ ◄── { "type": "room.joined", … } ───────────────── │
  │ ◄── { "type": "sdp.offer", "sdp": … } ──────────── │
  │                                                    │
  ├── { "type": "sdp.answer", "sdp": … } ────────────► │
  ├── { "type": "ice.candidate", … } ───────────────► │  (several)
  │ ◄── { "type": "ice.candidate", … } ────────────── │  (several)
  │                                                    │
  │        ═══ ICE → DTLS → SRTP; media flows ═══      │
  │                                                    │
  │ ◄── { "type": "connection.state", … } ─────────── │
  │                                                    │
  ├── { "type": "track.publish", "source": "camera" }► │
  ├── { "type": "sdp.offer", "sdp": … } ────────────► │
  │ ◄── { "type": "sdp.answer", "sdp": … } ────────── │
  │                                                    │
  │ ◄── { "type": "track.published", … } ──────────── │  (to everyone else)
```

---

## Writing a client

Five things that are easy to get wrong:

1. **Answer the server's offer.** It offers first, including for your own
   publishing in most cases. A client that waits to be asked will wait
   forever.
2. **Handle `track.published` and `ontrack` in either order.** They race.
3. **Buffer ICE candidates** that arrive before you have set a remote
   description — adding one early is an error in WebRTC.
4. **Retry on `NEGOTIATION_GLARE`**, and only after answering the offer
   that caused it.
5. **Re-join on reconnect.** There is no session resumption. Rebuild from
   the `room.joined` and the offer that follow.

---

## See also

- [Architecture](./architecture.md) — why the protocol has this shape
- [SFU](./sfu.md) — what happens on the other side of it
- [Migrating from LiveKit](../migration/from-livekit.md) — the mesh-to-SFU protocol change
