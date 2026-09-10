# Livqeno RTC — Architecture

Livqeno owns its realtime communication infrastructure end to end: the
control plane that authorizes calls, the signaling protocol that
negotiates them, and the SFU that forwards the media. It is built on open
WebRTC standards — ICE, DTLS-SRTP, RTP/RTCP — and implements no custom
media protocol.

```text
┌─────────────────────────────────────────────┐
│              Livqeno Client SDKs               │
│  Web · React · React Native · Flutter        │
└──────────────────────┬──────────────────────┘
                       │  WebSocket + HTTPS
┌──────────────────────▼──────────────────────┐
│             Livqeno Control Plane              │
│  Auth · Projects · Rooms · Participants      │
│  Permissions · Tokens · Signaling            │
│  Server selection                            │
└──────────────────────┬──────────────────────┘
                       │  node link (WebSocket)
┌──────────────────────▼──────────────────────┐
│               Livqeno SFU Layer                │
│  ICE · DTLS · SRTP · RTP/RTCP                │
│  Track routing · Simulcast · Data channels    │
└─────────┬────────────────────────┬──────────┘
          │                        │
     STUN / TURN            PostgreSQL + Redis
      (coturn)
```

Media never crosses the control plane. It goes directly from a client to
the SFU node serving its room, over WebRTC.

---

## The two planes

Everything in Livqeno RTC divides into a **control plane** and a **media
plane**, and almost every design decision follows from keeping them apart.

| | Control plane | Media plane |
|---|---|---|
| What | Livqeno API (NestJS) | Livqeno SFU (Go/Pion) |
| Carries | Authorization, room state, negotiation | Audio, video, screen, data |
| Protocol | HTTPS + WebSocket | ICE / DTLS-SRTP / RTP |
| State | Durable (Postgres), shared (Redis) | Per-call, in-process |
| Scales by | Adding stateless instances | Adding nodes; rooms are assigned to one |
| Restart cost | None — clients reconnect | Drops the calls on that node |

### Why clients never address the SFU

A client is given `endpoint` — Livqeno's signaling WebSocket — and never an
SFU's address. It learns the serving node's *name*, for support, and
nothing more.

This is the single most consequential choice in the architecture. Because
no client ever learned a media address or a media protocol, the media
plane can be redeployed, re-sharded, re-regioned, or reimplemented without
an SDK release. It is what made replacing LiveKit a one-line change to a
default rather than a breaking release.

The cost is a hop: negotiation travels client → API → SFU rather than
client → SFU. That hop carries a handful of small JSON frames per call and
never a byte of media, so it costs milliseconds once, at join.

---

## Joining a call

```text
Application backend                          Client
        │                                       │
        │  1. POST /v1/rooms/{id}/rtc-tokens    │
        │◄──────────────────────────────────────┤
        │     (your own auth, your own rules)   │
        │                                       │
        ▼                                       │
   Livqeno API ── mints a short-lived token ──────┤
        │                                       │
        │  2. { token, endpoint, iceServers }   │
        └──────────────────────────────────────►│
                                                │
                        3. WebSocket connect + room.join
                                                │
                                                ▼
                                        Livqeno Signaling
                                                │
                              4. verify token, allocate a node
                                                │
                                                ▼
                                          Livqeno SFU
                                                │
                              5. create PeerConnection, offer
                                                │
                        6. answer + trickle ICE │
                                                ▼
                                    ICE → DTLS → SRTP → media
```

**1–2. Token.** Your backend asks Livqeno for a token, with its own rules
about who may join what. Livqeno never sees your users. The response carries
everything the SDK needs: the token, the signaling `endpoint`, and
`iceServers` (STUN plus TURN credentials minted fresh for this token).
Forward all three as-is.

**3. Connect.** The SDK opens the signaling WebSocket with the token in a
query parameter — a WebSocket handshake cannot carry custom headers in a
browser — and sends `room.join`.

**4. Authorize and allocate.** The token's signature is verified before
any claim in it is read. The room gets an SFU: its existing one if it has
a live session, otherwise the least-loaded healthy node, preferring the
requested region. Every participant in a room lands on the same node —
that is what makes it an SFU rather than a mesh.

**5–6. Negotiate.** The SFU creates a `PeerConnection` and offers. The
client answers. ICE candidates trickle both ways. DTLS handshakes, SRTP
keys are derived, and media flows directly between client and node.

`room.joined` arrives before the media connection completes — it is the
end of the control-plane part of joining, not the end of joining.

---

## Negotiation: the SFU offers

The SFU is the offerer, and the client answers. Even for publishing.

That is the opposite of the usual browser-to-browser pattern, and it
follows from who knows what: the SFU owns the subscriber side of every
connection, and on join it already knows every track the participant
should receive. Having it offer means a participant joining a call in
progress sees and hears everyone as soon as ICE completes — rather than
connecting to silence and then receiving one renegotiation per existing
participant.

Publishing is the one case a client must offer, and only the first time it
publishes a given kind, when no transceiver exists yet. Later publishes
reuse the transceiver and ride the SFU's next offer.

### Glare

Two offers in flight on one `PeerConnection` leaves it wedged. This is the
classic WebRTC failure, and a room where several people join at once
produces it constantly: every join changes everyone else's subscribed
track set, so renegotiations start moments apart.

Livqeno resolves it by rule, not by luck:

- The SFU holds a negotiation from creating an offer until its answer is
  applied — not merely while building the offer. A track change arriving
  mid-round-trip is *recorded*, and one follow-up offer is sent when the
  round trip completes. A burst of ten changes collapses into one extra
  offer, not ten.
- A client-initiated offer arriving while the SFU has one in flight is
  refused with a retryable code (`NEGOTIATION_GLARE`). The SFU is the
  impolite peer: its offer stands, and the client retries after answering
  it. The SDK does this automatically.
- A round trip whose answer never arrives is abandoned after 15 seconds,
  so a vanished client cannot block that participant's renegotiations for
  the rest of the call.

---

## Tracks

A track is audio or video plus a **source** — camera, microphone, or
screen share.

WebRTC has no notion of source. It carries audio and video; the intent is
application metadata. And a browser page cannot choose the `MediaStream`
or `MediaStreamTrack` id that ends up in the SDP — both are read-only. So
codec kind is all the SFU could otherwise infer from, and that cannot tell
a screen share from a camera.

The client therefore **declares** it, over signaling, before negotiating:

```text
client → server:  { "type": "track.publish", "trackId": "...", "source": "screenShare" }
```

The SFU holds the declaration against the track id and applies it when the
media arrives. The two race — declaration and media are handled
independently — so a track may briefly carry a kind-based fallback before
being corrected.

### Mute is not unpublish

Muting disables the track (`track.enabled = false`), so the platform sends
silence or black frames. The RTP stream continues, the transceiver stays,
and unmuting is instant. The SFU is told separately so it can stop
forwarding the silence to every subscriber rather than paying to relay it.

Stopping the track instead would release the device — turning off the
camera light, which users read as "off" — but would then need a fresh
capture and a renegotiation to undo. Both behaviours exist:
`setCameraMuted()` for a mute button, `disableCamera()` to release the
device.

---

## Simulcast

A publisher sends three spatial layers; each subscriber receives one.

```text
Publisher                 SFU                    Subscribers
                                          ┌──► high    (desktop, full tile)
  camera ──┬── low   ────►  layer   ──────┼──► medium  (grid tile)
           ├── medium ────►  selector     └──► low     (phone, thumbnail)
           └── high   ────►
```

The ladder is quarter-pixel steps — 1×, 2×, 4× downscale — which is what
native WebRTC implements well. Screen shares deliberately do *not*
simulcast: the content is usually text, where dropping resolution destroys
legibility in a way it does not for a face.

Each subscriber gets its own forwarding path, which is what makes
per-subscriber layer choice possible at all. Sharing one output across
subscribers would force them all to the same bitrate, defeating the point.

### Switching layers

Two things make a switch invisible:

**Keyframe gating.** Switching mid-frame hands a decoder a picture that
references frames it never received — several seconds of green smear or a
frozen image. So a switch waits for a keyframe on the target layer, and
the SFU asks the publisher for one immediately (PLI) rather than waiting
for the encoder's next scheduled keyframe.

**Sequence rewriting.** Each layer is a separate RTP stream with its own
sequence numbers and timestamps. Forwarding raw numbers across a switch
looks to the subscriber's jitter buffer like tens of thousands of lost
packets. The SFU keeps a per-subscriber monotonic sequence space and
re-anchors it at the switch, so the subscriber sees one continuous stream
that happens to change resolution.

### Choosing a layer

A subscriber can ask (`subscription.update`), and mobile SDKs ask
automatically based on how large the view actually is — the "viewport"
input. A request is a **preference, not a command**: the SFU will not hand
over a layer the publisher is not sending.

> **Not implemented yet:** automatic downgrade under congestion. TWCC
> feedback is on the wire but nothing consumes it to drive selection, so a
> subscriber on a degrading connection sees loss rather than a lower
> layer. See [scaling](./scaling.md#known-gaps).

---

## Reconnection

A reconnect **re-runs the whole join**. The previous session's
`PeerConnection` is gone, `room.join` allocates a fresh one, and the SDK
rebuilds from the offer that follows.

That is more work than resuming a session, and it is deliberate: an ICE
restart on a connection that has already failed is less reliable than
starting clean, and the client has to handle a fresh session anyway when
the network changed underneath it — a Wi-Fi to cellular handover is a new
network path, not a hiccup on the old one.

What the application does *not* have to do is rebuild the room. Track
subscriptions, publications, and the participant roster are all restored
by the SDK.

```text
connection lost
      │
      ├─► refresh the token (if a refresher was supplied)
      │
      ├─► reconnect with jittered exponential backoff
      │     300ms → 600ms → 1.2s → … → 10s, up to 12 attempts
      │     full jitter, so a fleet-wide blip is not a thundering herd
      │
      ├─► room.join → new node assignment → new PeerConnection
      │
      └─► restore publications and subscriptions
```

Reconnection stops immediately for failures a retry cannot fix — an
invalid or expired token, a revoked permission, a room that no longer
exists. Those need a fresh token from your backend, not another attempt.

On the SFU side, a node whose control-plane link drops does **not** drop
its calls. Sessions survive a 45-second grace period, because a blip
between the API and a node says nothing about the client's own connection,
which runs over a different path entirely.

---

## Data channels

`room.sendData()` rides a WebRTC data channel, not the signaling socket.

```ts
await room.sendData(new TextEncoder().encode(JSON.stringify({ kind: 'reaction', emoji: '🎉' })));

room.on('dataReceived', (payload) => {
  const message = JSON.parse(new TextDecoder().decode(payload));
});
```

The channel gets the same NAT traversal and encryption as media, and does
not compete with negotiation for the control connection. It is opened on
demand — a channel costs an SCTP association, and most calls never send
data — and is ordered and reliable by default.

Payloads are capped at 64 KiB. The channel shares the media transport, so
a caller pushing megabytes through it stalls their own video.

**No sender is attributed.** The SFU fans data out on each recipient's own
channel, so the transport carries no sender identity. Put the sender in
your own payload if you need it — and remember that it is then a claim,
not a fact.

---

## Network quality

Everything reported is measured. Nothing is estimated to fill a gap.

```ts
const stats = await room.getConnectionStats();
// per published track and per subscribed track:
//   bitrateBps, packetsLost, packetLossPercent, jitterMs,
//   roundTripTimeMs, codec, frameWidth/Height, framesPerSecond
```

A field the browser did not report is `undefined`, not `0`. Zero packet
loss and "no report has arrived yet" are different facts, and conflating
them makes a quality readout worse than none.

Round-trip time and send-side loss come from the *receiver's* RTCP
reports, because a sender only knows what it handed to the network. This
is why RTT is available for audio and often absent for video.

`room.getDiagnostics()` is the cheap, synchronous counterpart — safe to
call from an error handler, and safe to paste into a bug report: it
contains no token and no secret.

---

## Where things live

| Concern | Code |
|---|---|
| Token minting and verification | `apps/api/src/modules/rtc-tokens` |
| Signaling protocol and gateway | `apps/api/src/modules/signaling` |
| The node link (API ↔ SFU) | `apps/api/src/modules/signaling/sfu`, `services/sfu/internal/signal` |
| Server registry and allocation | `apps/api/src/modules/rtc-servers` |
| Rooms, tracks, forwarding | `services/sfu/internal/room` |
| Web SDK adapter | `packages/sdk/src/internal/sfu/raven-adapter.ts` |
| Flutter engine | `sdks/flutter/raven_rtc/lib/src/internal` |

---

## Further reading

- [Signaling protocol](./signaling.md) — the wire contract, message by message
- [SFU](./sfu.md) — the media plane and how to operate it
- [Networking](./networking.md) — ports, NAT, firewalls, TURN
- [Scaling](./scaling.md) — multiple nodes, regions, measured capacity
- [Security](./security.md) — tokens, secrets, permission enforcement
- [Migrating from LiveKit](../migration/from-livekit.md) — what changed and why
