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
