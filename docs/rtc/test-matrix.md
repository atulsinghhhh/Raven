# Raven RTC — test matrix

What Raven's native WebRTC stack is actually tested against, what those
tests prove, and what has not been tested yet.

This document exists because "we tested it" is not a claim anyone can act
on. The interesting question is always *at what size, on what network,
against which browser* — so every row below either names a test you can
run or says plainly that it has not been run.

> **Nothing here establishes production readiness.** Every automated test
> in this repo runs on loopback, in one process or one machine, with no
> real network between the peers. That is the right place to catch a
> design mistake and the wrong place to learn what a deployment can hold.
> The gaps in §5 are the reason, and they are gaps, not caveats.

Current totals, all passing with no skips: **71** Go tests in
`services/sfu`, **157** API e2e tests across six suites (four of them
against a real SFU, two of those in a real browser), **546** API unit
tests, and **188** web-SDK tests.

---

## 1. How to run it

```bash
# The SFU's own tests: real Pion peers, real ICE/DTLS/SRTP, real RTP.
cd services/sfu && go test -race ./...

# Including the slow scale cases (2/10/50/100 participants, 20-way mesh).
cd services/sfu && go test ./internal/room/ -run TestScale -v

# The signaling e2e: real WebSocket clients → real API → real SFU.
# Needs a scratch Postgres; the suite refuses to run against a shared one.
docker run --rm -d --name raven-e2e-db -p 5455:5432 \
  -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=raven postgres:16-alpine
E2E_DB="postgresql://postgres:scratch@localhost:5455/raven"
DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" pnpm --filter @raven/api prisma:migrate:deploy
DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" pnpm --filter @raven/api test:e2e

# The browser suites need Chromium once.
pnpm --filter @raven/api exec playwright install chromium

# The web SDK against a fake RTCPeerConnection.
pnpm --filter @corvidhq/rtc test

# The media-plane scale script, which drives the Go tests above.
scripts/rtc-load-test.sh --with-100
```

---

## 2. Participant scale (spec §39)

Measured with `go test ./internal/room/ -run TestScale -v` on an
Apple-silicon laptop. One publisher, N−1 subscribers, so every received
packet costs N−1 writes — the shape that stresses forwarding hardest per
unit of inbound media.

| Participants | Join (all N connected) | Downtracks built | Every subscriber received forwarded RTP |
|---|---|---|---|
| 2 | 130 ms | 1 | yes |
| 10 | 172 ms | 9 | yes |
| 50 | 368 ms | 49 | yes |
| 100 | 601 ms | 99 | yes |
| 20, full mesh (everyone publishes) | 1.21 s | 380 subscriptions | yes |

**These are loopback join times, and nothing else.** Every participant
runs in the same process as the SFU, over loopback, with a synthetic
100-packet-per-second stream: no encoder, no jitter, no loss, no NAT, and
no bandwidth limit. What the numbers show is that the forwarding mesh is
built in full and that join cost grows roughly linearly rather than
quadratically at these sizes — which is what would break first if a lock
were held across a network write.

What they do **not** show is capacity. A real 100-participant room means
100 encoders, ~100 Mbps of egress, and a hundred separate networks. Per-
node capacity has to be measured against a deployed node under real
codec load; see [scaling](./scaling.md).

Per §39, **no participant count beyond 100 has been tested, and no
capacity figure is claimed anywhere in these docs.**

---

## 3. What is covered, by layer

### Media plane — `services/sfu` (Go, real Pion peers)

| Capability | Test |
|---|---|
| Two-participant forwarding | `TestSFUForwardsMediaBetweenTwoParticipants` |
| Fan-out to many subscribers | `TestSFUForwardsToMultipleSubscribers` |
| Track published mid-call, renegotiated | `TestSFUForwardsTrackPublishedMidCall` |
| Publish refused without permission (§38, re-checked at the node) | `TestSFURejectsPublishWithoutPermission` |
| Tracks unpublished when a participant leaves | `TestSFUUnpublishesTracksWhenParticipantLeaves` |
| Empty rooms reaped | `TestSFUReapsEmptyRooms` |
| Stale session evicted on reconnect | `TestSFUEvictsStaleSessionOnReconnect` |
| Room capacity enforced at the node | `TestSFUEnforcesRoomCapacity` |
| Room state reports live participants and tracks | `TestRoomStateReportsLiveParticipantsAndTracks` |
| Mute stops forwarding without tearing the track down | `TestPublisherMuteStopsForwardingWithoutUnpublishing` |
| Declared source beats the codec-kind guess (§16) | `TestDeclaredTrackSourceOverridesTheKindGuess`, `TestDeclaredSourceBeforeMediaArrives`, `TestInvalidDeclaredSourceIsIgnored` |
| Simulcast: only the selected layer forwarded | `TestDownTrackDropsPacketsFromOtherLayers` |
| Simulcast: switch waits for a keyframe | `TestDownTrackWaitsForKeyframeBeforeSwitching` |
| Simulcast: sequence numbers stay continuous across a switch | `TestDownTrackRewritesSequenceContinuouslyAcrossLayerSwitch` |
| The shared packet is never mutated per-subscriber | `TestDownTrackDoesNotMutateTheSharedPacket` |
| Requested vs. actual layer reported separately (§19) | `TestDownTrackReportsRequestedAndActualLayerSeparately` |
| Keyframe detection: VP8, VP9, H.264, unknown codec | `keyframe_test.go` |

### Node link — `services/sfu/internal/signal`

| Capability | Test |
|---|---|
| Unauthenticated control plane rejected | `TestNodeLinkRejectsAnUnauthenticatedControlPlane` |
| Several API instances on one node | `TestNodeLinkAcceptsSeveralControlPlanes` |
| Full join and media flow over the wire | `TestNodeLinkFullJoinAndMediaFlow` |
| `ROOM_FULL` distinguishable from a generic failure | `TestNodeLinkReportsRoomFullDistinctly` |
| Unknown session rejected | `TestNodeLinkRejectsAnUnknownSession` |
| Teardown on `participant.remove` | `TestNodeLinkParticipantRemoveTearsDownTheSession` |
| ICE/DTLS state reported from the media plane, not inferred | `TestNodeLinkReportsConnectionStateFromTheMediaPlane` |
| A state query does not create a session | `TestNodeLinkQueryDoesNotRegisterASession` |
| Unknown frame types ignored rather than fatal | `TestNodeLinkIgnoresAnUnknownFrameType` |

### Real browsers — `apps/api/test/effects-*.e2e-spec.ts`

Two Chromium contexts driven by Playwright, against a real SFU, with
Chrome's synthetic camera standing in for hardware. These are the only
tests in the repo where actual browser WebRTC talks to Raven's media
plane.

| Capability | Test |
|---|---|
| A browser joins, publishes a camera, and the media connection reaches `connected` | `effects-rtc`: "connects to a real SFU room…" |
| A second browser **subscribes and decodes frames** from the first (`videoWidth > 0`) | `effects-rtc`: "a viewer receives the publisher-processed video…" |
| Effects disabled, re-enabled, cleared and detached mid-call without dropping the connection | both `effects-rtc` tests |
| The same, through the live-streaming host/viewer endpoints and a real stream lifecycle | `effects-live-streaming` |

The subscriber test was skipped for a long time, blamed on the sandbox's
network handling. That was wrong, and the skip was hiding a real bug:
the web SDK matched an arriving track to its announcement by
`RTCTrackEvent.track.id`, which is **not** the remote track id — Chrome
mints a fresh local one and ignores the `msid` that carries the real one.
Every arriving track was parked as "media arrived early" and no
subscription ever completed. It is fixed (the id now comes from the
remote SDP's `a=msid:` line, located by the transceiver's mid) and pinned
in `packages/sdk/test/raven-adapter.spec.ts`.

Worth stating because it shapes how much the rest of this document is
worth: **no amount of Go-side or fake-transport testing would have caught
it.** The SFU forwarded correctly the whole time; the bug was in how a
browser reports what it received.

### Control plane — `apps/api/test/signaling.e2e-spec.ts`

Real `ws` clients → real API → a real SFU built from `services/sfu` and
spawned by the suite. 33 tests covering: node registration and
heartbeating; token authentication including expiry and audience; the
room-vs-token mismatch check; every permission gate (`join`, `publish`,
`subscribe`); message validation including the rejected-not-defaulted
rules for track source and simulcast layer; the SFU offering first with a
genuine session description (ICE credentials, DTLS fingerprint,
`setup:actpass`); real trickled ICE candidates bound inside the
configured UDP range; glare refused as retryable; membership events; mute
broadcast; live room state read back through the dashboard API; the
idle-vs-unknown distinction; the per-IP connection limit; abrupt
disconnect, graceful leave, and reconnect eviction.

It does **not** prove media flows: `ws` is not a WebRTC endpoint, so
nothing answers the SFU's offer. That is what the Go tests and the
browser suites above are for.

### Web SDK — `packages/sdk`

188 tests against a fake `RTCPeerConnection` (`test/helpers/fake-webrtc.ts`):
the adapter's signaling handling, negotiation ordering, the
`track.published`/`ontrack` race in both orders, realm-safe payload
conversion, device enumeration, stats mapping, and error classification.

### Mobile SDKs

React Native: 76 tests, including the audio adapter's honest
`NOT_SUPPORTED` reporting. Flutter: 32 tests, including the signaling
client. Both fake the transport; neither runs on a device in CI.

---

## 4. Browser interoperability (spec §40)

| Browser | Version | Status |
|---|---|---|
| Chromium (desktop) | Playwright's pinned build | **Tested, automated** — publish, subscribe, decode, effects mid-call |
| Chrome (desktop) | current | **Tested manually** — two tabs against a live stack |
| Firefox (desktop) | — | **Not tested** |
| Safari (desktop) | — | **Not tested** |
| Edge (desktop) | — | **Not tested** |
| Safari (iOS) | — | **Not tested** |
| Chrome (Android) | — | **Not tested** |

Only Chromium/Chrome has been exercised. `isBrowserSupported()` is a
feature detector rather than a user-agent allowlist, so an untested
browser with the right capabilities will report supported — that is a
statement about capabilities present, not about interop verified.

The `msid` bug above is the concrete argument for widening this: it was a
browser-behaviour mismatch that every other layer of testing agreed was
fine. Firefox and Safari have their own such behaviours.

The four things most likely to break first, in the order they are worth
testing:

1. **Safari, unified plan and simulcast.** Historically the largest
   source of native-WebRTC surprises. Safari's simulcast support has
   real limits, and the SFU's 3-layer ladder assumes all three arrive.
2. **Safari autoplay.** An attached `<video>`/`<audio>` may need `muted`
   or a user gesture before playback starts. This is a UI-integration
   problem, not an SFU one, but it presents as "no video".
3. **Firefox `getDisplayMedia`** behaviour, particularly whether audio
   capture is available.
4. **Mobile browsers**, where `getDisplayMedia` is frequently absent
   entirely — the case `NOT_SUPPORTED` exists for.

---

## 5. Network conditions and NAT traversal (spec §41)

**None of this has been tested.** Stated as a gap rather than described
as covered.

| Condition | Status |
|---|---|
| Host candidates, same machine | Covered implicitly by every test above |
| STUN, server-reflexive candidates | **Not tested** |
| TURN relay, UDP | **Not tested** |
| TURN relay, TCP | **Not tested** |
| TURN relay, TLS (`turns:`) | **Not tested** |
| Symmetric NAT on both sides (relay-only) | **Not tested** |
| Packet loss (1%, 5%, 20%) | **Not tested** |
| Added latency (50 ms, 200 ms, 500 ms) | **Not tested** |
| Constrained bandwidth | **Not tested** |
| Network change mid-call (Wi-Fi → cellular) | **Not tested** |

The ICE and TURN machinery is implemented and configured — coturn with
ephemeral HMAC credentials, `iceServers` minted per token, a bounded UDP
range the node advertises truthfully. See [networking](./networking.md).
What is missing is evidence that it works when a direct path is
unavailable, which is exactly the case TURN exists for and exactly the
case that does not arise on loopback.

Two of these gaps are worse than the rest:

- **Relay-only has never been exercised.** A bug in the TURN credential
  scheme or the candidate handling would be invisible to every test in
  this repo and would present as "calls fail for some users on corporate
  networks".
- **Loss and latency are where congestion control would show, and there
  is no congestion control.** The SFU registers TWCC feedback but nothing
  consumes it, so a subscriber on a degrading connection sees packet loss
  rather than being dropped to a lower simulcast layer. Testing under
  loss would measure the absence of a feature rather than a regression —
  which is why it is listed here rather than claimed.

---

## 6. What would change the picture

In rough order of how much each would tell you:

1. **A real relay-only test.** Two peers forced onto TURN, media
   verified. Cheap to set up with a firewall rule, and it closes the
   largest gap in §5.
2. **Safari and Firefox, two tabs, real media.** Manual is fine; the
   value is in the first run, not in the automation. Playwright can drive
   both, and the browser harness in `apps/api/test/e2e-harness/` already
   exists — so this is mostly a matter of pointing it at `firefox` and
   `webkit` and reading what breaks.
3. **A load test against a deployed node under codec load**, so
   [scaling](./scaling.md) can state a per-node number instead of
   declining to.
4. **Loss and latency under a bandwidth estimator**, once there is one.

---

## See also

- [Architecture](./architecture.md) — how the pieces fit
- [SFU](./sfu.md) — the media plane
- [Networking](./networking.md) — ports, NAT, TURN
- [Scaling](./scaling.md) — what is and is not known about capacity
- [Migration map](../architecture/native-rtc-migration-map.md#5-capability-matrix) — the capability matrix these tests back
