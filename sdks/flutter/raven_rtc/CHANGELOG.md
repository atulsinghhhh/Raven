## 0.1.5

Fixes a data channel that could silently never open, found via a real
Flutter-to-Flutter and Flutter-to-browser end-to-end sweep against a real
backend and SFU. No public API changes.

* **Fixed:** `RavenEngine.ensureDataChannel()` created the local data
  channel but never negotiated it — unlike `publish()`/`unpublish()`,
  nothing else was ever going to prompt an offer for a participant who
  only wants `data`. A channel opened this way either rode along behind
  some unrelated publish's negotiation round, or, for a participant that
  never published anything, never opened at all: `RavenRoom.data`'s
  listener calls `ensureDataChannel()` exactly this way (spec §8), so a
  receive-only participant could not send *or* receive data.
  `ensureDataChannel()` now awaits the same join-time barrier `publish()`
  does and negotiates through the same guarded path, so the channel it
  creates is always the one actually offered to the SFU.
* Added regression coverage (`test/engine_test.dart`) proving
  `ensureDataChannel()` negotiates on its own, with no publish required.

## 0.1.4

Fixes a join-time negotiation race that could leave the SFU's very first
offer permanently unanswered, found via a real end-to-end sweep against a
real backend, SFU and browser. No public API changes.

* **Fixed:** `SignalingClient.send()` refused to send anything but
  `room.join` until the server's `room.joined` confirmation arrived,
  gating on `_joined`. The SFU's join-time offer reaches the client over
  a path with no ordering relationship to that confirmation — it travels
  node-link → gateway → socket independently of the join handler's own
  response — and the SFU builds and sends that offer synchronously, with
  no I/O in between, so it frequently wins the race. When it did, the
  client answered it correctly but `send()` silently dropped the answer,
  and the SFU waited out its full 15s `answerTimeout` for an answer that
  was never coming. `send()` now gates on a new `_joinSent` flag that
  flips the instant `room.join` is dispatched, so an answer or ICE
  candidate produced while a join is still in flight is no longer
  discarded.
* Added regression coverage (`test/signaling_client_test.dart`) pinning
  this exact race: an SFU offer arriving and being answered before
  `room.joined` has arrived.
* Verified via a real end-to-end sweep — a real Flutter Web build joining
  a real live stream through a real local SFU, with a real browser
  viewer's raw `RTCPeerConnection.getStats()` confirming `framesDecoded`
  and `bytesReceived` genuinely increasing — at 20/20 with zero dropped
  answers and zero negotiation timeouts.

## 0.1.3

Fixes a negotiation-glare bug that could leave a locally "published"
track never actually negotiated with the SFU, found via a real
end-to-end run against a real backend, SFU and browser. No public API
changes.

* **Fixed:** the SFU is the impolite peer in a glare (both sides
  offering at once) by design: it refuses the client's offer with a
  retryable `NEGOTIATION_GLARE` and expects the client to answer its
  own offer, then retry. `RavenEngine` received that error and simply
  discarded it — no rollback, no retry — so a track added right as the
  SFU's join-time offer arrived could sit on the peer connection with
  `track.publish` declared but never actually negotiated. Every other
  participant then saw that source as not published
  (`camera=false`/`microphone=false`) even though `enableCamera()` /
  `enableMicrophone()` reported success. `_handleOffer` now rolls the
  local offer back before accepting a colliding SFU offer, and a
  glared publish is requeued and retried once that round completes.
* **Fixed:** the retry itself could stay queued forever. It decided
  whether to negotiate by reading `RTCPeerConnection.signalingState`,
  which flutter_webrtc only updates from an asynchronous platform
  event; read immediately after our own rollback-and-answer (exactly
  where the retry needs to fire), it could still report the
  pre-answer state on Flutter Web. It now asks the platform directly
  (`getSignalingState()`) instead of trusting that cache.
* Every operation that can change the peer connection's signaling
  state (an incoming SFU offer, an incoming SFU answer, a local
  publish) is now serialized through one queue, so two of them can no
  longer interleave against a signaling state the other has since
  moved past.
* Added regression coverage (`test/engine_test.dart`) for glare
  recovery specifically: a colliding SFU offer rolling ours back, a
  glared publish surviving instead of being dropped, a publish
  deferred behind our own offer retrying once that offer is answered
  (not only once the SFU offers again), and the full
  publish → glare → rollback → retry → accepted sequence end to end.
* Verified via repeated real end-to-end runs — a real Flutter Web
  build publishing camera and microphone to a real live stream through
  a real local SFU, with a real browser subscriber's raw
  `RTCPeerConnection.getStats()` confirming `framesDecoded` and
  `bytesReceived` actually increase — including runs where the glare
  condition fired live and recovered correctly.
* **Known issue, not fixed here:** a separate, rarer race was found
  during this verification, unrelated to glare: a viewer joining right
  as a Flutter host's negotiation completes can occasionally time out
  waiting to subscribe. It traces to the SFU only subscribing a new
  participant to tracks it already considers published at join time,
  combined with this SDK's `ready`/publish-success signals meaning the
  local offer was sent, not that the SFU has accepted it yet. Fixing
  it would mean changing the SFU or the readiness contract; out of
  scope for this release.

## 0.1.2

Fixes `Raven.join()` rejecting rooms identified by name, found via a
real end-to-end check of `raven_live` against a real backend and SFU.
No public API changes.

* **Fixed:** `Raven.join(roomId)` only ever validated `roomId` against
  the RTC token's internal room id (`rid`), and then sent `roomId` —
  whatever the caller passed — verbatim on the wire. A token also
  carries the room's human name (`rnm`), and a caller who legitimately
  knows the room only by that name (a live stream's public id, which is
  what its underlying room's `name` is set to server-side) got rejected
  outright with `RavenErrorCode.roomNotFound`, or, once the local check
  was widened to accept either claim, still got rejected server-side:
  the signaling layer names a room by `rid` alone, and this SDK was
  sending its own `roomId` argument on the wire instead of the token's.
  `join()` now accepts a match against either claim, and the wire value
  is always the token's own `rid` — matching the web SDK's
  `assertTokenMatchesRoom`/`roomIdFromToken` exactly. A token naming no
  room at all now fails fast with `RavenErrorCode.invalidToken` instead
  of silently sending nothing meaningful.
* Added regression coverage (`test/raven_test.dart`) for the precheck
  accepting either claim, rejecting neither, and the no-room-claim
  failure mode.
* Verified via a genuine end-to-end run: a real Flutter Web build
  publishing camera and microphone to a real live stream through a real
  local SFU, with a real browser subscriber observing `framesDecoded`
  and `bytesReceived` actually increase over a sustained window — and
  the reverse direction, a real browser host with a real Flutter Web
  viewer subscribing to it. See `apps/api/test/flutter-live-streaming.e2e-spec.ts`
  and `flutter_check/live_host`.

## 0.1.1

Fixes a signaling/negotiation lifecycle bug that could prevent remote
media from ever arriving. No public API changes.

* **Fixed:** `RavenEngine` and `RavenRoom` now subscribe to signaling
  *before* `SignalingClient.connect()` is called, not after it resolves.
  Previously, `RavenRoom.attach()` and `RavenEngine.start()` ran only
  once the join had already completed, which left a window for the
  server's own messages — an `sdp.offer` most of all — to arrive on a
  broadcast stream with no subscriber yet and be silently dropped, with
  no `sdp.answer` ever sent back. Subscribing first closes that window
  unconditionally, matching how the web SDK registers its signaling
  listeners before awaiting `connect()`.
* **Fixed:** `RavenEngine.applyJoinedState()` — which restores announced
  tracks and reconciles the roster — was never called on the *first*
  join, only on reconnects. `RavenRoom._handleJoined()` now runs the same
  path both times.
* **Fixed:** `sendData()` could send into a data channel that had not
  finished opening. It now waits for the channel to open before sending;
  nothing sent while it's still coming up is dropped.
* **Fixed:** a participant that only listens for `RavenRoom.data` and
  never publishes or calls `sendData()` now still gets a local data
  channel opened (`RavenEngine.ensureDataChannel()`), so the SFU has
  somewhere to relay incoming data onto. Previously such a participant
  could not receive data either, only send it.
* Added unit-level regression coverage for all of the above
  (`test/engine_test.dart`, `test/room_test.dart`) against a mocked
  `flutter_webrtc` platform channel. Live end-to-end media validation
  against a real SFU and real devices should still be run before
  depending on this release for production calls — see
  `docs/sdk/flutter.md`.

## 0.1.0

Initial release (Livqeno Phase 13).

* `Raven` / `RavenRoom` — join, leave, camera, microphone, screen share,
  front/rear camera switch.
* `RavenVideoView` — renders a participant, follows track changes, and
  disposes its native texture with the widget.
* `RavenPermissions` — camera and microphone prompts without an extra
  plugin.
* Typed errors (`RavenException`, `RavenPermissionException`) sharing the
  web SDK's vocabulary.
* Adaptive streaming and dynacast on by default, which the web SDK leaves
  off — a phone pays for resolution it isn't showing.
