# Native Raven RTC — Migration Map

Status: **stages 1–5 complete and tested; mobile SDKs, observability, CLI,
full test matrix, LiveKit removal and documentation outstanding.** See the
[capability matrix](#5-capability-matrix) for what is verified and the two
[known gaps](#gaps-stated-plainly).

This document is the output of the pre-implementation audit. It records what
LiveKit currently does for Raven, what replaces each piece, and the order in
which the replacement can safely land. It is the reference for every
subsequent stage of the migration, and it supersedes the decision recorded in
[`sfu-comparison.md`](./sfu-comparison.md) (see [Technology decision](#4-technology-decision)).

---

## 1. Current vs. target architecture

```text
CURRENT                             TARGET

Application                         Application
    │                                   │
Raven SDK (@corvidhq/rtc)           Raven SDK (@corvidhq/rtc)
    │                                   │
    │  LiveKitAdapter                   │  RavenAdapter
    ▼                                   ▼
livekit-client                      Raven Signaling (WebSocket)
    │                                   │
    │  LiveKit signaling protocol       ▼
    ▼                               Raven SFU (Go/Pion)
LiveKit Server                          │
    │                                   ▼
    ▼                               Native WebRTC
WebRTC                              (ICE/DTLS/SRTP/RTP/RTCP)
```

Control plane, today and after, is the same NestJS API — what changes is what
sits behind it:

```text
CURRENT                     TARGET

Raven API                   Raven API
    ↓                           ↓
livekit-server-sdk          Raven Signaling
(AccessToken,                   ↓
 TokenVerifier,             Raven SFU
 RoomServiceClient)             ↓
    ↓                       WebRTC
LiveKit Server
    ↓
WebRTC
```

---

## 2. What the audit found

Two RTC paths exist in the repository today, and only one of them carries media.

**Path A — the live media path.** `createRTCClient()` → `RTCClient` →
`LiveKitAdapter` → `livekit-client` → LiveKit Server. Every real call runs
here. Tokens are LiveKit `AccessToken` JWTs minted by
`RtcTokensService`, carrying a LiveKit `VideoGrant` plus three custom
attributes (`ravenProjectId`, `ravenRoomId`, `ravenEnvironment`).

**Path B — a P2P mesh signaling relay.** `apps/api/src/modules/signaling/*` is
a complete, tested, Raven-owned WebSocket signaling server — but it relays
`sdp_offer` / `sdp_answer` / `ice_candidate` between *participants*
(`targetParticipantId`), which is a full-mesh peer-to-peer topology. It has no
SFU on the other end and no track model. It authenticates with the same
LiveKit-format JWT via `RtcTokenVerifierService`.

This is the single most important finding: **Raven already owns a signaling
server, but it signals the wrong topology.** Path B is not a stepping stone
toward the SFU architecture the target requires — its message contract
(`targetParticipantId` on every SDP/ICE message) encodes mesh assumptions.
Its transport, authentication, rate limiting, Redis fan-out, heartbeat, and
multi-instance room registry are all directly reusable; its *protocol* is not.

Three pieces of good news for the migration:

1. `packages/sdk/src/internal/sfu/types.ts` already defines an `SFUAdapter`
   interface, and `Room`/`RTCClient` are written against it — never against
   `livekit-client`. `RTCClient`'s constructor already takes an injectable
   `adapterFactory`. A native adapter is a drop-in, with **no public API
   change**.
2. `RtcTokensService` already returns a Raven-owned response shape
   (`token` / `endpoint` / `iceServers` / `telemetryUrl`), documented as "a
   Raven-owned contract, not tied to whatever SFU sits behind it". Only the
   token's internal format is LiveKit's.
3. TURN is already Raven-owned: `turn-credential.util.ts` mints ephemeral
   HMAC coturn credentials per token, sharing the token's TTL. Nothing about
   TURN depends on LiveKit.

And three that are harder:

4. `LiveKitRoomService` (`RoomServiceClient`) is the *only* source of live
   room truth for the dashboard and for live-stream viewer counts. Postgres
   holds control-plane records only. Replacing it requires the SFU to expose
   its own state and the registry to aggregate it.
5. The React Native SDK depends on LiveKit for more than signaling —
   `registerGlobals()` (WebRTC polyfills), `AudioSession` (audio routing),
   and `RTCView` (native video rendering) come from
   `@livekit/react-native{,-webrtc}`. These are platform primitives, not SFU
   concerns, and need `react-native-webrtc` equivalents.
6. `packages/sdk/src/track.ts`, `internal/media/*`, `internal/devices/*` and
   `internal/telemetry/track-stats.ts` reference LiveKit types for
   `MediaStreamTrack` wrapping and `getStats()` parsing. Mostly type-level,
   but it means the track layer needs rework alongside the adapter.

---

## 3. Dependency inventory

Every LiveKit touchpoint, categorized `REMOVE` / `REPLACE` / `KEEP` / `ADAPT`.

`KEEP` means the code stays as-is and is not LiveKit-coupled beyond a comment
or a name. `ADAPT` means the logic survives but is reworked. `REPLACE` means a
Raven-native implementation takes over the same responsibility. `REMOVE` means
the capability is gone or absorbed elsewhere.

### 3.1 Runtime package dependencies

| Dependency | Where | Action |
|---|---|---|
| `livekit-server-sdk@^2.9.2` | `apps/api` | **REMOVE** — after §3.2 replacements land |
| `livekit-client@^2.22.0` | `packages/sdk`, `packages/react-native-sdk` | **REMOVE** — replaced by `RavenAdapter` on native `RTCPeerConnection` |
| `@livekit/react-native@^2.12.0` | `packages/react-native-sdk` | **REPLACE** → `react-native-webrtc` (globals, audio session) |
| `@livekit/react-native-webrtc@^144.1.2` | `packages/react-native-sdk` | **REPLACE** → `react-native-webrtc` (this is a fork of it) |
| `livekit_client@^2.11.0` | `sdks/flutter/raven_rtc` | **REPLACE** → `flutter_webrtc` + Dart Raven signaling client |
| `minimumReleaseAgeExclude: livekit-client@2.22.0` | `pnpm-workspace.yaml` | **REMOVE** |

### 3.2 Control plane (`apps/api`)

| File | LiveKit surface used | Action | Replacement |
|---|---|---|---|
| `modules/rtc-tokens/rtc-tokens.service.ts` | `AccessToken` | **REPLACE** | `RavenTokenService` — Raven JWT, Raven claim vocabulary. Response shape unchanged. |
| `modules/rtc-tokens/rtc-token-grant.mapper.ts` | `VideoGrant`, `TrackSource` | **REMOVE** | Permissions serialize directly; no foreign grant vocabulary to translate into |
| `modules/rtc-tokens/rtc-token-grant.mapper.spec.ts` | — | **REPLACE** | Tests move to the native token service |
| `modules/signaling/authentication/rtc-token-verifier.service.ts` | `TokenVerifier`, `fromLiveKitGrant` | **REPLACE** | Verifies Raven's own JWT |
| `modules/rooms/livekit-room.service.ts` | `RoomServiceClient` | **REPLACE** | `SfuControlService` — queries Raven SFU nodes via the registry |
| `modules/rooms/rooms.service.ts`, `rooms.module.ts`, `dashboard-rooms.controller.ts` | `LiveKitRoomService` injection | **ADAPT** | Same shape, new provider |
| `modules/live-streams/live-streams.service.ts` | `LiveKitRoomService` for viewer counts | **ADAPT** | Same |
| `modules/signaling/interfaces/signaling-message.interface.ts` | mesh protocol (`targetParticipantId`) | **REPLACE** | SFU-oriented protocol (§6 of spec) |
| `modules/signaling/messages/message-router.service.ts` | mesh routing | **REPLACE** | Routes to assigned SFU, not to peers |
| `modules/signaling/gateway/signaling.gateway.ts` | — | **KEEP** | Transport/auth/heartbeat/rate-limit/Redis fan-out all reusable |
| `modules/signaling/rooms/room-registry.service.ts`, `room-events.service.ts` | — | **KEEP** | Fleet-wide membership + fan-out, topology-agnostic |
| `modules/signaling/rate-limit/*` | — | **KEEP** | |
| `shared/config/configuration.ts` | `livekit.{url,apiKey,apiSecret,internalUrl}` | **REPLACE** | `sfu.*` + `rtcToken.signingSecret` |
| `shared/config/env.validation.ts` | `LIVEKIT_*` required vars | **REPLACE** | `SFU_*`, `RTC_TOKEN_SECRET` |
| `modules/health/dependency-checks.util.ts`, `health.controller.ts` | LiveKit reachability probe | **ADAPT** | Probe the SFU registry / SFU health endpoint |
| `modules/observability/error-classifier.ts` | LiveKit error strings | **ADAPT** | Classify Raven SFU + native WebRTC failures |
| `modules/observability/diagnostics.service.ts` | comment only | **KEEP** | |
| `modules/observability/guards/telemetry-ingest.guard.ts` | comment only | **KEEP** | |
| `modules/rtc-tokens/turn-credential.util.ts` | comment only | **KEEP** | Already Raven-native ephemeral TURN creds |
| `modules/rtc-tokens/dto/rtc-token-permissions.dto.ts` | doc comment | **KEEP** | Public API vocabulary — must not change |
| `modules/chat/tokens/chat-token.service.ts`, `chat.module.ts`, `realtime/chat-event.interface.ts` | comparison comments | **KEEP** | Chat is a separate service; no LiveKit coupling |
| `prisma/schema.prisma` | doc comments only | **ADAPT** | Comments updated; new `RtcServer` + room assignment models added |
| `main.ts` | comment | **KEEP** | |

### 3.3 Web SDK (`packages/sdk`)

| File | Action | Notes |
|---|---|---|
| `internal/sfu/livekit-adapter.ts` | **REMOVE** | Replaced by `internal/sfu/raven-adapter.ts` |
| `test/livekit-adapter.spec.ts` | **REPLACE** | Becomes `raven-adapter.spec.ts` |
| `internal/sfu/types.ts` | **KEEP** | The `SFUAdapter` boundary is exactly right. Two doc comments mention LiveKit; `getConnectionQuality()` semantics change (see note below) |
| `client.ts` | **ADAPT** | `defaultAdapterFactory` points at `RavenAdapter`; public `createRTCClient` untouched |
| `room.ts` | **ADAPT** | `getDiagnostics()` can now fill in the real `iceConnectionState` / `signalingState` that LiveKit hid |
| `track.ts`, `internal/media/*`, `internal/devices/enumerate.ts` | **ADAPT** | Wrap raw `MediaStreamTrack` instead of LiveKit track objects |
| `internal/telemetry/track-stats.ts` | **ADAPT** | Parse `RTCStatsReport` directly |
| `test/setup.ts`, `test/browser-support.spec.ts` | **ADAPT** | Mocks change |
| `package.json`, `scripts/print-bundle-size.mjs` | **ADAPT** | Drop the dependency; bundle-size baseline changes |
| `index.ts`, `errors.ts`, `events.ts`, `participant.ts`, `config.ts`, `logger.ts` | **KEEP** | No LiveKit coupling. One exception: `config.ts:decodeTokenPayload` reads `json.video.room` — a LiveKit claim path — and must move to Raven's claim shape |

> **`getConnectionQuality()` semantics.** Today this reads LiveKit's own
> server-computed quality verdict. Raven's SFU must compute and report an
> equivalent, because the current doc comment is right that the SFU has the
> better vantage point. Until the SFU reports it, the adapter must return
> `'unknown'` — **not** a client-side guess dressed up as a server verdict.
> Spec §19: never fake quality metrics.

### 3.4 React SDK (`packages/react-sdk`)

`src/index.ts`, `src/store.ts`, `test/helpers/fake-rtc-client.ts` — comments and
a fake built against the `@corvidhq/rtc` surface. **KEEP**; the React SDK never
touches LiveKit. This is the payoff of the existing adapter boundary.

### 3.5 Mobile SDKs

| File | Action | Notes |
|---|---|---|
| `packages/react-native-sdk/src/internal/bootstrap.ts` | **REPLACE** | `registerGlobals` from `react-native-webrtc` |
| `packages/react-native-sdk/src/audio.ts` | **REPLACE** | `AudioSession` → `react-native-webrtc` audio routing |
| `packages/react-native-sdk/src/video-view.tsx` | **REPLACE** | `RTCView` from `react-native-webrtc` |
| `packages/react-native-sdk/src/raven.ts`, `index.ts`, `internal/lifecycle.ts` | **ADAPT** | |
| `packages/react-native-sdk/package.json`, `tsup.config.ts`, `test/*` | **ADAPT** | Peer deps, externals, mocks |
| `sdks/flutter/raven_rtc/lib/src/{raven,room,types,permissions,video_view,errors}.dart` | **REPLACE** | `flutter_webrtc` + Dart signaling client |
| `sdks/flutter/raven_rtc/pubspec.yaml` | **REPLACE** | |
| `sdks/flutter/raven_live/lib/raven_live.dart` | **ADAPT** | |

### 3.6 Server SDKs, CLI, dashboard

| File | Action |
|---|---|
| `packages/server-sdk/src/resources/errors-resource.ts` | **ADAPT** — error taxonomy comment |
| `sdks/python/src/raven/resources/errors.py` | **ADAPT** — same |
| `packages/cli/src/lib/types.ts`, `commands/projects/inspect.ts` | **ADAPT** — surfaces LiveKit config in project inspect |
| `apps/dashboard/src/lib/api-client.ts` | **ADAPT** — one type/comment |

### 3.7 Infrastructure and deployment

| File | Action |
|---|---|
| `infrastructure/docker/livekit/livekit.yaml` | **REMOVE** |
| `docker-compose.yml` (livekit service, 24 refs) | **REPLACE** — `sfu` service |
| `docker-compose.scale.yml` | **ADAPT** — scale the SFU, not LiveKit |
| `infrastructure/k8s/base/api-configmap.yaml`, `api-secret.yaml` | **REPLACE** — `LIVEKIT_*` → `SFU_*` / `RTC_TOKEN_SECRET` |
| `infrastructure/k8s/base/*` | **ADAPT** — add an SFU deployment (host-network / hostPort for media) |
| `.env`, `.env.example` | **REPLACE** — `LIVEKIT_*` vars |
| `.github/workflows/e2e.yml` | **ADAPT** |
| `scripts/verify-infra.sh`, `scripts/rtc-load-test.sh`, `scripts/k6/*` | **ADAPT** |
| `eslint.config.mjs` | **ADAPT** — vendored-bundle ignore patterns |

### 3.8 Test harnesses and examples (vendored LiveKit bundles)

Five checked-in copies of `livekit-client.esm.mjs`, each ~1MB, plus built
`raven-rtc.js` bundles that inline it:

- `apps/api/test/e2e-harness/vendor/livekit-client.esm.mjs` (+ `raven-rtc.js{,.map}`)
- `examples/media-demo/`, `examples/video-call/`, `examples/live-streaming-demo/`
- `examples/mobile-rtc-chat/`, `examples/rtc-chat/`, `examples/react-video-call/`

All **REMOVE**, replaced by rebuilt `raven-rtc.js` bundles with no LiveKit
inside. `examples/*/README.md` and `App.tsx` files **ADAPT**.

### 3.9 Documentation

~40 files under `docs/` and `apps/docs/content/`. All **ADAPT** or **REPLACE**
per spec §44. Two files intentionally retain LiveKit references:

- `docs/architecture/sfu-comparison.md` — the historical decision record.
- `docs/migration/from-livekit.md` (new, spec §45) — the migration guide.

Per spec §42, these are the only permitted remaining references, and both are
migration/history documentation with no runtime effect.

---

## 4. Technology decision

**Chosen: Pion (Go) for the SFU media plane.** New Go module at `services/sfu`.

This reverses `sfu-comparison.md`'s conclusion, deliberately and for a reason
that document itself anticipated: it rejected Pion as "too low-level to be a
Phase 1 foundation" and rejected mediasoup as needing "a signaling server you
build yourself". Both objections were correct *when the goal was reaching a
working room fastest*. The goal is now the opposite — Raven must own the
control plane and the media plane — so the cost that made Pion unattractive is
now the requirement, and "LiveKit owns the signaling protocol and much of the
media-routing decision logic", the trade-off that document knowingly accepted,
is precisely what has to be undone.

Assessed against spec §4's criteria:

| Criterion | Pion (Go) | mediasoup (Node+C++) |
|---|---|---|
| Scalability | Goroutine-per-track, single static binary, trivial horizontal scale | Worker processes per core; more moving parts to supervise |
| Maintainability | One language for the whole media plane; readable Go | JS orchestration over a C++ worker; debugging spans both |
| Licensing | MIT | ISC — both fine |
| Language ecosystem | Separate process boundary from the Node control plane, which is what we want architecturally | Shares Node with the control plane, blurring the boundary |
| Performance | Userspace Go; good, and CPU-bound work is SRTP + packet copy | C++ worker is faster per core |
| Observability | Native Prometheus, pprof | Available, less direct |
| Interoperability | Standards-compliant WebRTC, no custom protocol | Same |
| Mobile compatibility | Irrelevant server-side; both interop with `react-native-webrtc` / `flutter_webrtc` | Same |
| Routing control | Total — we write layer selection, bandwidth estimation, forwarding | High, but within mediasoup's abstractions |

mediasoup is faster per core and would have been the choice if raw density
were the deciding factor. It is not: the deciding factors are total control of
routing logic (§8, §15, §18), a clean process boundary between control and
media planes, and a single-binary deployment story for §24 horizontal scaling.
Pion wins those, and its lower per-core throughput is addressed by scaling out
rather than up — which the architecture requires anyway.

**mediasoup remains the documented fallback** if per-node density becomes the
binding constraint. Because the SDK talks to Raven's own signaling protocol and
never to the SFU's native protocol, swapping the media plane later does not
break SDK users — which is exactly the property spec §4 demands.

Not chosen: **LiveKit** (the thing being removed). **Janus / Jitsi** — both are
full servers with their own protocols and room models, so adopting either
recreates the current problem with a different vendor. **Building ICE/DTLS/SRTP
from scratch** — explicitly rejected; spec §9 says use standards-compliant
WebRTC, not custom media protocols, and Pion *is* the standards-compliant
implementation.

---

## 5. Capability matrix

Per spec §47 — nothing here may be marked done until Raven has a **tested**
equivalent. Status is updated as stages land.

| LiveKit capability | Raven implementation | Where | Status |
|---|---|---|---|
| Room model | Raven Room | Prisma `Room` + SFU room manager | **Done** — SFU room lifecycle tested (create, join, reap) |
| Participant model | Raven Participant | Prisma `Participant` + SFU peer | **Done** — incl. stale-session eviction on reconnect |
| Access tokens | Raven RTC token (own JWT, own claims) | `modules/rtc-tokens/rtc-token-signer.service.ts` | **Done** — 49 tests, incl. tamper/expiry/audience |
| Token verification | `RtcTokenVerifierService` over the same signer | `modules/signaling/authentication` | **Done** |
| Permissions / RBAC | `RtcPermissions`, enforced at signaling *and* on the node | `rtc-token.claims.ts`, `room/permissions.go` | **Done** — SFU independently rejects an unauthorized publish |
| Signaling protocol | Raven Signaling, SFU-oriented | `modules/signaling` | **Done** — mesh protocol replaced; 546 API unit tests plus 33 e2e against a real node |
| SFU / media routing | Raven SFU | `services/sfu` (Go/Pion) | **Done** — real RTP verified through 71 Go tests, race-clean |
| ICE / DTLS / SRTP | Pion (server), browser WebRTC (client) | `services/sfu`, `packages/sdk` | **Done** — real ICE/DTLS in SFU media tests |
| RTP/RTCP, NACK, PLI, TWCC | Pion interceptors + Raven's PLI coalescing and subscriber-feedback relay | `services/sfu/internal/room` | **Done** — standards-compliant, not reimplemented |
| Simulcast + layer selection | Raven SFU layer selector; SDK configures the 3-layer ladder | `downtrack.go`, `raven-adapter.ts` | **Done for VP8/VP9/H.264** — keyframe-gated switching and sequence rewriting. A switch cannot complete on AV1 or H.265, whose keyframes are not detected; those forward fine single-layer |
| Bandwidth / congestion control | *Not implemented* | — | **Gap** — see [Known risks](#7-known-risks) |
| Data channels | SCTP channel + `room.sendData()` | `participant.go`, `raven-adapter.ts` | **Done** — server-side fan-out; 64 KiB payload limit |
| Reconnection | SDK reconnect with jittered backoff, full rejoin, token refresh | `signaling-client.ts` | **Partial** — reconnect eviction and rejoin tested end to end; a real network switch (Wi-Fi ↔ cellular) is untested |
| Browser-to-browser media | Real Chromium peers through the SFU | `apps/api/test/effects-*.e2e-spec.ts` | **Done** — a second browser subscribes and decodes frames; this is what caught the `msid` bug below |
| Network stats / quality | Real `getStats()` parsing, both directions | `internal/telemetry/rtc-stats.ts` | **Partial** — per-track numbers are real; the SFU-side *quality verdict* is a gap (below) |
| Live room state (`RoomServiceClient`) | `SfuRoomStateService` over the node link, plus a Redis track cache | `modules/rooms/sfu-room-state.service.ts` | **Done** — `LiveKitRoomService` deleted; keeps serving / idle / unknown distinct end to end |
| Server discovery / region | RTC server registry + allocator | `modules/rtc-servers` | **Done** — 36 tests incl. region fallback and concurrent allocation |
| TURN | coturn, Raven-minted ephemeral credentials | `turn-credential.util.ts` | **Done** — already Raven-native before this migration |
| Mobile WebRTC bindings | `react-native-webrtc`, `flutter_webrtc` | mobile SDKs | **Partial** — both SDKs ported and unit-tested (76 RN, 32 Flutter); neither has run on a device |
| Browser interoperability | Standards-compliant WebRTC, feature-detected support | `packages/sdk/src/browser-support.ts` | **Partial** — Chromium publish/subscribe/decode automated in CI; Firefox, Safari and Edge untested. See [test matrix](../rtc/test-matrix.md#4-browser-interoperability-spec-40) |
| NAT traversal over a relay | coturn, ephemeral credentials, bounded UDP range | `turn-credential.util.ts`, `services/sfu` | **Gap** — implemented and configured, but no test has ever forced media onto a relay. The largest untested surface in the stack |

### Gaps, stated plainly

Two things LiveKit did that Raven does not do yet, plus two things that
have been built but not verified. All four are recorded here rather than
quietly marked complete, per §47. The full accounting of what is and is
not tested is in the [test matrix](../rtc/test-matrix.md).

**Congestion control (spec §18).** The SFU registers Pion's TWCC
interceptor, so the feedback exists on the wire, but nothing consumes it to
drive layer selection. Today a subscriber gets the layer it asked for (or
the best available), and it is not automatically dropped when its
connection degrades. Consequence: a participant on a poor connection sees
loss rather than a lower-resolution stream. The layer-selection machinery
this needs is already in place (`DownTrack.RequestLayer`); what is missing
is the estimator that decides.

**SFU-side quality verdict (spec §19).** `getConnectionQuality()` returns
`'unknown'`. LiveKit computed this server-side, where loss and jitter from
every leg of the room are visible — a vantage point a client cannot have.
Rather than return a client-side guess in the shape of a server verdict,
the adapter returns "unknown", which is the honest answer.
`room.getConnectionStats()` returns real, measured per-track numbers in the
meantime.

**Relay-only NAT traversal (spec §41).** Every automated test in this
repo runs on loopback, where a host candidate always works — so the TURN
path has never actually carried media. The credentials, the `iceServers`
response and coturn itself are all in place and unit-tested, but a bug in
any of them would be invisible here and would present in production as
"calls fail for some users on corporate networks". This is the cheapest
gap to close and the most expensive to leave open.

**Browser interoperability (spec §40).** Only Chromium/Chrome has been
exercised with real media, though that is now automated rather than
manual. `isBrowserSupported()` is a feature detector, so an untested
browser with the right capabilities reports supported — a statement about
capabilities present, not about interop verified. Safari's simulcast
limits are the specific risk, since the SFU's 3-layer ladder assumes all
three layers arrive.

The argument for closing this gap is concrete rather than theoretical.
Getting a real browser into the test loop immediately found a bug that
every other layer had agreed was fine: the web SDK matched an arriving
track to its announcement by `RTCTrackEvent.track.id`, which is not the
remote track id — Chrome mints a fresh local one and ignores the `msid`
that carries the real one. Browser-to-browser subscription had therefore
**never worked**, and it failed silently, as a subscription that never
completed rather than as an error. The test that would have caught it was
skipped, with a plausible-sounding explanation about the sandbox's
network. Firefox and Safari have their own such behaviours, and nothing
in this repo would notice them either.

---

## 6. Implementation order

Sequenced so that each stage is independently testable and nothing is deleted
before its replacement passes tests (spec §42).

1. **Native token service** — Raven JWT, own claims, plus verifier. Unblocks
   everything, removes `livekit-server-sdk` from the token path, and is
   independently unit-testable. Public token API response unchanged.
2. **RTC server registry + allocation** — `RtcServer` model, heartbeat ingest,
   health, region selection, room→SFU assignment. Needed before the SFU has
   anywhere to report to.
3. **Raven SFU (`services/sfu`)** — Pion room manager, peer connections, RTP
   forwarding, track lifecycle, data channels, metrics, heartbeat. Testable
   headlessly against Pion-based synthetic clients.
4. **SFU-oriented signaling protocol** — replaces the mesh protocol; bridges
   client ↔ assigned SFU.
5. **`RavenAdapter`** in `packages/sdk` — native `RTCPeerConnection`. At the end
   of this stage the backward-compatibility test of spec §43 must pass.
6. **`SfuControlService`** replaces `LiveKitRoomService`; observability,
   dashboard RTC section, CLI, server SDKs.
7. **Mobile SDKs** — RN then Flutter.
8. **Test matrix** — §39–41, including scale and NAT/TURN.
9. **LiveKit removal** — §42, only after 1–8 pass.
10. **Documentation** — §44, §45.

Stages 1–2 and 3 are parallelizable (different languages, no shared files).
Stage 5 depends on 4; stage 4 depends on 3.

---

## 7. Known risks

- **Congestion control is the hardest part.** Getting bandwidth estimation and
  layer selection right under real packet loss is where a hand-built SFU most
  visibly underperforms a mature one. Plan: implement TWCC feedback and
  conservative layer switching first, measure under simulated loss (§41), and
  treat aggressive estimation as a later optimization rather than a launch
  requirement.
- **`getConnectionQuality()` regression window.** Between removing LiveKit's
  server-side quality verdict and shipping Raven's, the honest answer is
  `'unknown'`. Reporting anything else would violate §19.
- **Mobile is a second full client implementation.** RN and Flutter each need
  their own signaling client and negotiation logic. Sharing the protocol
  definition across all three clients is a hard requirement, not a nicety.
- **Safari interop** is historically the biggest source of native-WebRTC
  surprises (unified-plan quirks, simulcast limits). Must be tested early,
  not at the end.
- **`RoomServiceClient` has no direct substitute.** Live room state currently
  comes from an authoritative single server. In a multi-SFU fleet it must be
  aggregated across nodes, which introduces staleness the dashboard has to
  represent honestly.
- **Scale claims.** §39 requires measured results at 2/10/50/100 participants.
  Nothing about capacity may be stated in docs until measured.

---

## 8. Removal, and the references that intentionally remain

Spec §42 asks for a global grep for `livekit|LiveKit|LIVEKIT` after removal,
and for any surviving reference to be intentional with a stated reason. This
section is that statement.

### What was verified gone

| Surface | Check | Result |
|---|---|---|
| Runtime dependencies | `package.json`, `pubspec.yaml`, `go.mod` across the repo | none |
| Lockfiles | root `pnpm-lock.yaml`, `sdks/flutter/*/pubspec.lock`, `examples/*/package-lock.json`, `services/sfu/go.sum` | none |
| Source imports | `from 'livekit`, `@livekit/`, `livekit_client`, `livekit-server-sdk` across `apps`, `packages`, `sdks`, `services` | none |
| Installed tree | `node_modules` after `pnpm prune` | none |
| Vendored browser bundles | `examples/*/raven-*.js`, `apps/api/test/e2e-harness/vendor/` | rebuilt from current source; no LiveKit code |
| Deployment | `docker-compose.yml`, `infra/k8s/`, `.env`/`.env.example`, CI | no service, no image, no env var |

The three example `package-lock.json` files were regenerated rather than
hand-edited. They were the last place a `npm install` could still have pulled
`livekit-client` in, even though the `package.json` files beside them were
already clean — a stale lockfile is a real dependency, not a stale comment.

### The categories that remain, and why

Every surviving textual match falls into one of five categories. Nothing
outside them survives.

**1. This document, and `sfu-comparison.md`.** The audit and the superseded
decision record it reverses. Describing what changed requires naming what it
changed from, and `sfu-comparison.md` is kept because the trade-off it
knowingly accepted is exactly what this migration undid — deleting it would
erase the reasoning rather than the dependency.

**2. `docs/migration/from-livekit.md`.** The migration guide. §45 requires it.

**3. Comments that say what a piece of code replaced.** For example
`rtc-token-signer.service.ts` ("Replaces `livekit-server-sdk`'s
`AccessToken`/`TokenVerifier`"), `internal/sfu/types.ts` (why the
`SFUAdapter` boundary existed before it was needed), `room/permissions.go`
("what replaced polling LiveKit's `RoomServiceClient`"),
`native-audio.ts` (why audio routing is an interface rather than a direct
dependency), and `rtc-token.claims.ts` (the two permission behaviours
deliberately preserved from the old grant mapper).

These are load-bearing. Each one answers "why is this shaped like this?"
for a decision whose *reason* was the thing being replaced. A comment
explaining that `resolvePermissions` treats an unset flag as denied
"because the previous implementation treated an unset `canPublish`/
`canSubscribe` pair as grant-both" is what stops someone simplifying that
logic back into a privilege escalation. Stripping the name out would leave
the rule with no visible justification.

The test for whether such a comment stays: it must be **past tense and
still true**. A comment claiming LiveKit is currently doing something is a
bug, not history — and every one of those was rewritten during removal
rather than left in place. That sweep also caught three claims that had
become outright false: OpenAPI descriptions telling callers their
permissions were "translated into a LiveKit access token grant", a build
script printing that "livekit-client stays an external peer dependency",
and a test-setup comment asserting `@corvidhq/rtc` pulls `livekit-client`
in transitively.

**4. Category comparison in `README.md`.** "Category peers: LiveKit Cloud,
Daily, Agora" — a factual statement about what kind of product Raven is,
unrelated to what it is built on, plus one pointer to the migration guide.

**5. Documentation that is deliberately about the past.** Three shapes,
all of them final rather than a to-do:

- **Pointer stubs.** `docs/sfu.md`, `docs/signaling.md`,
  `docs/signaling-protocol.md`, `docs/media-flow.md` and
  `docs/nat-traversal.md` were LiveKit-era *reference* docs. They are now
  short redirects with a per-section table of where each topic went.
  Replaced rather than banner-topped, because several message names
  survived the mesh-to-SFU change while their meanings did not — a reader
  skimming the old `sdp.offer` entry would have found a plausible, wrong
  answer, which is worse than finding nothing. Anything still true and
  not covered by `docs/rtc/` was folded in first: forcing a relay-only
  path, IPv6, close codes, protocol versioning, multi-instance signaling,
  heartbeats, and codecs.
- **Decision records.** `architecture/sfu-comparison.md`,
  `architecture/signaling.md`, `architecture/turn.md` and
  `architecture/infrastructure-decisions.md`. These *are* the history and
  are kept as history, with banners stating plainly which decision was
  reversed and why. `infrastructure-decisions.md`'s table is annotated
  rather than rewritten: a decision record that quietly matches the
  present is not a record.
- **Point-in-time reports.** `production/capacity-report.md` and
  `production/readiness-audit.md`. Banded, with the media-plane numbers
  explicitly marked as measuring a different SFU and a pointer to what
  has actually been measured since.

`architecture/webrtc.md` was in this set and is no longer: it is a WebRTC
primer, and standards do not go stale. It was corrected rather than
archived.

### The verification greps

The checks in the migration guide are deliberately narrower than a bare
`grep -i livekit`, which matches every comment in category 3 and would make
the check useless. They test for a *dependency*, which is what §42 is about:

```bash
# A declared dependency. Matches a dependency line, not a comment.
grep -rn --include=package.json --include=pubspec.yaml \
  '"\(livekit[a-z-]*\|@livekit/[a-z-]*\)"\s*:' . | grep -v node_modules
grep -rn '^\s*livekit_client\s*:' --include=pubspec.yaml .

# A resolved dependency, which is what actually gets installed.
grep -rln 'livekit' --include=package-lock.json --include=pubspec.lock \
  --include=go.sum . | grep -v node_modules
grep -n 'livekit' pnpm-lock.yaml

# An import. Anchored on import *syntax*, so it cannot match the prose in
# category 3 — several of those comments name `livekit-server-sdk` and
# `livekit_client` in a sentence, which a substring search cannot tell
# apart from an actual dependency.
grep -rnE "^[[:space:]]*(import|export)[^;]*['\"]@?livekit[a-zA-Z0-9._/-]*['\"]|require\([[:space:]]*['\"]@?livekit|['\"]package:livekit_client|\"github\.com/livekit/" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  --include='*.dart' --include='*.go' \
  apps packages sdks services examples | grep -v node_modules
```

All four return empty. A bare `grep -i livekit` does not, and should not —
it matches every comment in category 3, which is why the checks above test
for declaration and import syntax rather than for the string.
