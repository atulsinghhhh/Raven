# SFU Infrastructure (Phase 4)

This document covers Phase 4 of `INFRASTRUCTURE_PHASES.md`: integrating
the selected SFU into the platform and establishing the first real media
path. It builds on — and does not replace — Phase 0's SFU decision,
Phase 2's RTC tokens, and Phase 3's signaling.

## SFU choice

**LiveKit**, unchanged from Phase 0 (`docs/architecture/sfu-comparison.md`).
No new SFU work was needed to "add" LiveKit — it has been running since
Phase 1 (`docker-compose.yml`) and every RTC token since Phase 2 has
already been a real LiveKit-format JWT. What Phase 4 actually adds is
everything *around* that: TURN credentials in the token response, a real
browser client wired to LiveKit's SDK, and the documentation/verification
tying it together.

**Why**: ships production signaling, room/participant/track management,
and simulcast built in — reimplementing any of that ourselves would
violate the standing rule not to build WebRTC infrastructure from
scratch. See `docs/architecture/sfu-comparison.md` for the full
comparison against mediasoup and Pion.

## Architecture

```
                    CONTROL PLANE (Phase 2)
Developer
   |
   v
API ── PostgreSQL, Redis, Room config, RTC token + iceServers (TURN)
   |
   v
Client receives: { token, livekitUrl, roomName, iceServers }


                    MEDIA PLANE (Phase 4, new)
Client A ──WebRTC (LiveKit's own signaling + SFU protocol)──> LiveKit SFU
                                                                    |
                                                    +---------------+---------------+
                                                    v                               v
                                                Client B                        Client C
```

The control plane's involvement stops the moment it hands back a token —
it is never in the media path, and cannot be, by construction (it has no
WebRTC stack, no RTP handling, nothing that could carry media even by
accident). See `docs/media-flow.md` for the detailed "why."

## Resolving the Phase 3 signaling question

Phase 3 built a custom WebSocket signaling gateway per an explicit,
detailed specification, alongside LiveKit's own signaling — and flagged
this as an open tension for Phase 4 to resolve
(`docs/signaling.md#why-this-exists-alongside-livekit`). Phase 4's own
instructions resolve it explicitly: *"if the selected SFU provides
production-ready signaling, prefer using it... do not create two
competing signaling systems."*

**Resolution: the media path uses LiveKit's own signaling exclusively.**
The browser demo (`examples/media-demo/`) connects directly to LiveKit
via `livekit-client`, using LiveKit's own WebSocket protocol for SDP/ICE
negotiation — Phase 3's custom gateway (`/v1/rtc`) is not involved in
establishing media at all. Phase 3's gateway remains real, tested
infrastructure, available for whatever generic room/presence messaging a
future feature might want independent of media — but for RTC connection
establishment specifically, LiveKit is authoritative, and there is
exactly one system doing that job.

## Local deployment

No docker-compose changes were needed — LiveKit was already fully
configured for this in Phase 1: health check, required ports, internal
Docker networking, and external RTC ports were all already present. See
`docs/local-development.md` for the full port table. Summary:

| Port | Purpose |
|---|---|
| 7880 | HTTP/WebSocket signaling (LiveKit's own protocol) |
| 7881 | RTC media, TCP fallback |
| 50000-50019/udp | RTC media (ICE/SRTP) |

## Authentication

Unchanged token format, extended response. `POST /v1/rooms/:roomId/rtc-tokens`
(Phase 2) returns the same LiveKit JWT as before, now alongside an
`iceServers` array (new in Phase 4 — see TURN Integration below):

```json
{
  "token": "eyJhbGc...",
  "livekitUrl": "ws://localhost:7880",
  "roomName": "support-room",
  "participantIdentity": "alice",
  "iceServers": [
    { "urls": "stun:localhost:3478" },
    { "urls": "turn:localhost:3478?transport=udp", "username": "...", "credential": "..." },
    { "urls": "turn:localhost:3478?transport=tcp", "username": "...", "credential": "..." }
  ]
}
```

The client passes `token` and `iceServers` straight into
`room.connect(livekitUrl, token, { rtcConfig: { iceServers } })` — no
internal Docker service name (`livekit`, `coturn`) is ever exposed to a
client; only host-facing `LIVEKIT_URL`/`TURN_HOST` values are returned,
exactly as `docs/architecture/*.md` already established for every other
host-facing value in this project.

The developer's **API key** (Phase 2, `Authorization: Bearer <publicId>.<secret>`)
authenticates the *request that mints a token* — it is never sent to
LiveKit and never reaches a browser. The **RTC token** is what a
participant's browser uses to authenticate *to LiveKit*. These remain,
as designed in Phase 2, two different credentials with different blast
radii — see `docs/control-plane.md#two-authentication-models`.

## Room lifecycle

```
1. Client authenticates with the application (its own auth, out of scope here)
2. Client's backend requests an RTC token (Phase 2 API, API-key authenticated)
3. API validates room/project ownership, mints token + iceServers
4. Client connects directly to LiveKit (room.connect) using token + iceServers
5. LiveKit validates the token, admits the participant to its room object
6. Client publishes tracks (camera/microphone) — LiveKit receives them
7. LiveKit forwards each published track to every subscribing participant
8. Other participants' TrackSubscribed events fire; remote media renders
9. Participant disconnects/leaves — LiveKit removes them, fires ParticipantDisconnected for others
```

Verified live against the real stack — see the RTC Token Design and
Browser Demo sections in the Phase 4 completion report.

## Publishing

`room.localParticipant.setCameraEnabled(true)` / `setMicrophoneEnabled(true)`
(and `false` to stop) — this is the entire publishing surface exposed by
the demo, matching the Phase 4 scope (camera + microphone only, no
screen share, no advanced track management yet). LiveKit's SDK handles
`getUserMedia`, track creation, and publishing to the SFU internally.

## Subscribing

Subscription is automatic once `canSubscribe` is granted (the default for
any token minted with `subscribe: true` — see
`docs/control-plane.md#rtc-tokens`): LiveKit emits `TrackSubscribed` for
every track a participant is authorized to receive, without the client
requesting individual tracks explicitly.

**Why an SFU instead of every participant uploading to every other
participant directly:** with N participants each publishing camera +
microphone, a full mesh requires each participant to *upload* N-1 times
— bandwidth and CPU cost that grows linearly with room size on the
*sending* side, which is usually the weakest link (residential upload
bandwidth). An SFU inverts this: each participant uploads **once**,
regardless of room size, and the SFU (which has abundant, symmetric
server bandwidth) fans that single upload out to however many
subscribers exist. This is precisely what was verified in the browser
demo: Bob published once; the SFU is what makes it receivable by Alice
(and would equally make it receivable by a 3rd or 4th participant with
no additional cost to Bob).

## Simulcast

Enabled — it's `livekit-client`'s default behavior when publishing a
camera track (no opt-out was configured in the demo). LiveKit encodes
multiple resolution/bitrate layers from a single camera capture and lets
the SFU forward whichever layer fits each subscriber's available
bandwidth/CPU, without server-side transcoding. No custom simulcast logic
was written or would make sense to write — this is exactly the "use the
SFU's supported implementation" instruction.

## Codecs

Whatever the browser and LiveKit negotiate by default — VP8 (video) and
Opus (audio) in this environment, which is the most broadly compatible
combination across browsers today. No codec configuration was added;
Phase 4 explicitly prioritizes compatibility over experimenting with
VP9/AV1/H.264 at this stage, consistent with "use browser/SFU supported
codecs... prioritize compatibility over experimental codecs."

## TURN integration

The real, new work in Phase 4 (Phase 1 explicitly deferred it). coturn
has been configured with `use-auth-secret`/`lt-cred-mech` since Phase 1
specifically so this step could be added later without touching coturn
itself — and that's exactly what happened: `turn-credential.util.ts`
implements coturn's REST-API time-limited credential scheme
(`username = "<unix-expiry>:<label>"`, `credential = base64(HMAC-SHA1(secret, username))`),
verified directly against the running coturn container with
`turnutils_uclient` before being wired into the token endpoint (see the
Phase 4 completion report for that verification).

Every RTC token response now includes both a STUN entry and two TURN
entries (UDP + TCP transport) pointing at the same coturn deployment from
Phase 1, with credentials scoped to the requesting participant's identity
and the token's own TTL — nobody holds a long-lived TURN login. The
client passes these into `RTCConfiguration.iceServers`, giving WebRTC
both a direct path (via STUN-discovered candidates) and a TURN-relayed
fallback, exactly the "direct with TURN fallback" architecture the phase
asked for. Deeper TURN reliability work (health-based failover, cost
optimization) is explicitly Phase 5's job, not this one's.

## Observability

`GET /health` already reports LiveKit reachability indirectly through the
overall stack health (Phase 1/2); LiveKit's own Prometheus-compatible
metrics endpoint exists but wiring it into a dashboard is Phase 10's job,
not Phase 4's — consistent with "do not build the full RTC analytics
system yet."

## Known limitations (see the Phase 4 completion report for full detail)

- Single-region, single LiveKit instance (unchanged from Phase 1) — no
  autoscaling, no multi-region.
- No recording, transcoding, screen share, or advanced track management.
- The sandboxed test environment exhibited fake-camera device contention
  between two tabs sharing one virtual camera — a test-environment
  artifact, not a platform bug (see the completion report for the
  specific evidence that ruled this out).

## Troubleshooting

- **Participant can't connect at all**: check the RTC token hasn't
  expired (`expiresAt` in the response) and that `LIVEKIT_URL` is
  host-facing (`ws://localhost:7880` locally), not the internal Docker
  name.
- **Connects but no media flows and the network is restrictive**: verify
  the `iceServers` TURN entries actually authenticate — the same
  `turnutils_uclient` check used during development
  (`docs/architecture/turn.md`) is the fastest way to isolate whether the
  problem is TURN credentials vs. something else.
- **One participant's local video looks wrong/frozen in local testing**:
  if you're testing with two tabs on one machine with only one physical
  camera, both LiveKit connections may compete for the same OS-level
  camera device — this is a test-setup artifact, not a LiveKit or Raven
  issue. Use two separate machines, or a virtual camera, for a truly
  clean two-camera test.
