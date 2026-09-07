# Raven RTC — The SFU

The media plane. One Go binary that receives media from publishers and
forwards it to subscribers over standards-compliant WebRTC.

Source: `services/sfu`. Built on [Pion](https://github.com/pion/webrtc)
for ICE, DTLS, SRTP, RTP/RTCP and SCTP — Raven implements no media
protocol of its own.

---

## What it is and is not

**It is** a Selective Forwarding Unit: it decodes nothing, re-encodes
nothing, and mixes nothing. A packet arrives, is inspected, and is
forwarded to whoever should receive it. That is what keeps CPU cost linear
in participants rather than quadratic, and what keeps latency at one hop.

**It is not** an MCU. There is no server-side compositing. A client
receives one stream per publisher and lays them out itself.

**It holds no application state.** Rooms, participants, permissions and
tokens all live in the control plane. A node learns about them only
through the node link, which means a node can be replaced without a
migration and restarted without a backup.

---

## Anatomy

```text
                        ┌──────────────────┐
   Raven API  ═════════►│    node link     │   control only, no media
                        │  (WebSocket)     │
                        └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │     Manager      │   one webrtc.API for the node:
                        │                  │   UDP socket pool, interceptors
                        └────────┬─────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
      ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
      │  Room A   │        │  Room B   │        │  Room C   │
      └─────┬─────┘        └───────────┘        └───────────┘
            │
   ┌────────┼────────┐
   │        │        │
Participant ...   Participant        one PeerConnection each
   │
   ├── PublishedTrack ──┬── layer: low  ──┐
   │  (what they send)  ├── layer: medium ├──► DownTrack per subscriber
   │                    └── layer: high  ──┘   (own layer, own sequence space)
   │
   └── subscriptions (their copies of everyone else's tracks)
```

### One PeerConnection per participant

Some SFUs give each client two — one for publishing, one for subscribing
— to keep subscriber renegotiation from disturbing the publisher side.
Raven uses one, because a single connection means one ICE negotiation, one
DTLS handshake, one set of candidates to get through a firewall, and one
thing to reconnect.

The renegotiation problem that split avoids is handled instead by
serialising negotiation properly; see
[architecture](./architecture.md#glare).

### One DownTrack per subscriber per track

This is what makes per-subscriber simulcast possible. Sharing one output
across subscribers would force them all to the same layer, which defeats
the purpose: the participant on a phone over 4G and the one on a desktop
looking at a full-screen tile should not receive the same bitrate.

The cost is a per-subscriber write of every packet — inherent to selective
forwarding, and the reason outbound bandwidth on a node vastly exceeds
inbound.

---

## Codecs

Pion's defaults, registered with `RegisterDefaultCodecs()` and not
narrowed — video: VP8, VP9, H.264, H.265, AV1; audio: Opus, G.722, PCMU,
PCMA. The browser and the node negotiate from that set, which in practice
means **VP8 + Opus** for a Chrome-to-Chrome call today.

The SFU does not transcode and will not. It forwards RTP payloads
untouched, so which codec is in use is entirely a matter of what the two
ends agreed on in the SDP. That is also why the list above costs nothing
at runtime, and why a codec the publisher's browser refuses to encode
cannot be forced from the server.

### Simulcast needs the SFU to read the payload

Exactly one thing requires understanding the bytes: a layer switch has to
wait for a keyframe, or the subscriber's decoder gets a picture
referencing frames it never received. `internal/room/keyframe.go`
implements that for **VP8, VP9 and H.264** only.

For any other video codec — AV1 and H.265 among them — `isKeyframe`
returns false, and the consequence is worth stating precisely rather than
softening: **the layer switch never completes.** The subscriber keeps
receiving its current layer (so the call is not broken), packets on the
target layer are dropped, and the SFU keeps asking the publisher for a
keyframe it will never recognise — rate-limited to one request per 500 ms,
which is what stops that becoming a bandwidth problem on top of a
correctness one.

So: AV1 and H.265 negotiate and forward fine for a single-layer track.
**Do not rely on simulcast with them.** Adding a detector is a contained
change — one function and a test table — and until someone does, the
honest statement is that adaptive quality works on VP8, VP9 and H.264.

---

## Recovery: RTP/RTCP

Standards, registered rather than reimplemented.

| Mechanism | Who provides it | What it does |
|---|---|---|
| **NACK** | Pion interceptor | Retransmits a lost packet from the send buffer. |
| **PLI** | Raven | A subscriber's decoder asks for a keyframe; the SFU relays that to the publisher. |
| **FIR** | Raven | Treated like PLI. |
| **Periodic PLI** | Pion interceptor | Belt and braces: a subscriber whose own PLI was lost would otherwise wait for the encoder's next scheduled keyframe. |
| **Receiver/sender reports** | Pion interceptor | Carries loss, jitter and RTT. |
| **TWCC** | Pion interceptor | Transport-wide congestion feedback. **Collected but not yet consumed** — see [gaps](#known-gaps). |

Relaying subscriber PLIs to publishers is easy to omit and its absence is
subtle: the symptom is "video sometimes never recovers after a network
blip", because the decoder asked for a keyframe and nobody heard.

Keyframe requests are **rate-limited to one per 500ms per track**. Without
that, ten subscribers switching layers at once produce ten PLIs, and the
publisher's encoder answers each with a keyframe — a bandwidth spike
exactly when the network is already the problem. One keyframe serves all
of them.

---

## Operating a node

### Configuration

Everything has a working local default except the control-plane
credential; a node without it refuses to start rather than running as an
island that passes its own health check.

| Variable | Default | Notes |
|---|---|---|
| `SFU_REGISTRATION_SECRET` | — | **Required.** Fleet membership credential. |
| `SFU_NODE_ID` | `sfu-$HOSTNAME` | Stable across restarts, so a redeploy reclaims its registry row instead of orphaning it. |
| `SFU_REGION` | `local` | Free-form; the allocator treats it as a preference. |
| `SFU_PUBLIC_IP` | — | Advertised in ICE. **Set it in production.** See [networking](./networking.md#sfu_public_ip-is-not-optional-in-production). |
| `SFU_PUBLIC_HOST` | `localhost` | Recorded in the registry, for operators. |
| `SFU_CONTROL_PLANE_URL` | `http://localhost:4000` | Where to register. |
| `SFU_UDP_PORT_MIN` / `MAX` | 51000 / 51200 | Media. Must be published one-to-one and hold the advertised capacity. |
| `SFU_ROOM_CAPACITY` | 100 | Rooms this node advertises. A ceiling the allocator respects, not a target. |
| `SFU_HEARTBEAT_INTERVAL_SECONDS` | 10 | Must be well under the control plane's timeout. |
| `SFU_HTTP_ADDR` | `:7000` | Control only. Never expose publicly. |

### Endpoints

| Path | Purpose |
|---|---|
| `/internal/link` | The node link. Bearer-authenticated with the registration secret. |
| `/healthz` | Liveness: is the process answering. **Does not** check the control-plane link. |
| `/readyz` | Readiness: can this node take new participants. Requires a link. |
| `/metrics` | Prometheus. |

`/healthz` deliberately ignores the link. A node whose link is down is
still serving the calls already on it, and restarting it would drop them —
so it must not fail a liveness probe. `/readyz` is the one that reports
"do not send me new work".

### Registration and heartbeats

A node registers itself on boot and heartbeats every
`SFU_HEARTBEAT_INTERVAL_SECONDS` with its current load. Nothing in the
control plane provisions it: a node's existence is a fact about the
deployment, and requiring an operator to also declare it in a database is
how a fleet accumulates phantom rows for machines scaled down months ago.

Registration is idempotent by name and **resets the load counters** — a
freshly booted node is serving nothing, whatever the old row said.

A node that stops heartbeating is marked `UNHEALTHY` and stops receiving
new rooms. **Its existing rooms are left running.** A missed heartbeat is
often a paused container or a brief network blip, not a dead process, and
killing live calls over one would be far worse than the alternative. A
heartbeat from an unhealthy node promotes it straight back to healthy.

### Draining for a deploy

The SFU is stateful for the lifetime of a call. A restart drops the calls
on that node, so deploys drain rather than roll:

```bash
raven rtc servers drain sfu-asia-02     # stop new rooms; nobody is disconnected
raven rtc servers get sfu-asia-02       # watch activeRooms fall to 0
# then restart or replace the node
raven rtc servers drain sfu-asia-02 --undo
```

A drained node is not chosen for new rooms and its existing calls end
naturally. An operator's drain survives heartbeats — only an explicit
undrain brings it back, so the next heartbeat cannot silently undo the
decision.

---

## Metrics

Scrape each node directly. The API's `/metrics` carries fleet totals from
the registry, not per-node media detail — proxying that through the API
would put a fan-out to the whole fleet on every scrape.

```text
raven_sfu_active_rooms
raven_sfu_active_participants
raven_sfu_active_audio_tracks
raven_sfu_active_video_tracks
raven_sfu_node_link_connected        1 = a control plane is attached

raven_sfu_participants_joined_total
raven_sfu_participants_left_total
raven_sfu_connections_succeeded_total   with _failed_, the connection success rate
raven_sfu_connections_failed_total
raven_sfu_negotiations_started_total
raven_sfu_negotiation_failures_total
raven_sfu_layer_switches_total
raven_sfu_keyframes_requested_total

raven_sfu_media_bytes_received_total
raven_sfu_media_bytes_sent_total     expected ≫ received: one publisher, many subscribers
raven_sfu_media_packets_dropped_total  deliberate: muted, or a layer this subscriber
                                       is not receiving. NOT a loss indicator.
```

There is no aggregate "quality" gauge. A single number claiming to
summarise a room's health would be an invention.

---

## Logs

Structured JSON, with correlation ids on every line that has them:

```json
{
  "level": "INFO",
  "msg": "participant added",
  "service": "raven-sfu",
  "rtcServer": "sfu-asia-02",
  "roomId": "room_123",
  "participantId": "alice",
  "sessionId": "afd0d58c-…",
  "roomSize": 3,
  "subscribedTo": 2
}
```

`sessionId` is the control plane's own connection id, reused on the node
link — so a line here joins to a line in the API without a translation
table.

---

## Known gaps

Recorded rather than discovered. Also in the
[capability matrix](../architecture/native-rtc-migration-map.md#5-capability-matrix).

**Congestion control.** TWCC feedback is registered and on the wire, but
nothing consumes it to drive layer selection. A subscriber whose
connection degrades sees packet loss rather than being moved to a lower
layer. The selection machinery exists (`DownTrack.RequestLayer`); the
estimator that decides does not.

**No server-side quality verdict.** The SFU has the vantage point to
compute one — it sees loss and jitter on every leg of a room — and does
not yet. `getConnectionQuality()` in the SDKs therefore returns
`'unknown'` rather than a client-side guess dressed up as a server
verdict.

**No dynacast.** The SFU relays every layer a publisher sends, even one
nobody is subscribed to.

**Simulcast only on VP8, VP9 and H.264.** Keyframe detection is not
implemented for AV1 or H.265, and a layer switch that cannot find a
keyframe never completes — see [Codecs](#codecs). Single-layer tracks in
those codecs are unaffected.

**No room migration.** A room is assigned a node on first join and keeps
it for the session. Moving a live room means renegotiating every
participant; the abstraction for it exists (`assignedServerFor` /
`releaseRoom`) but the path does not.

---

## See also

- [Architecture](./architecture.md) — the whole picture
- [Signaling](./signaling.md) — the client-facing protocol
- [Scaling](./scaling.md) — multiple nodes, regions, measured capacity
- [Networking](./networking.md) — ports and NAT
