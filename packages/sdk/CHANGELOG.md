# @ravenkash/rtc

## 0.3.0

### Minor Changes

- [#43](https://github.com/atulsinghhhh/Raven/pull/43) [`1fca552`](https://github.com/atulsinghhhh/Raven/commit/1fca5522e8a977e5b311b0d3cb2f4ef79f3e1298) Thanks [@atulsinghhhh](https://github.com/atulsinghhhh)! - Serialize negotiation, restore media across reconnects, bootstrap the data channel, and support application-provided tracks

  Four RTC reliability fixes, all in the browser SDK's `RavenAdapter`. Found
  during an isolated static-page test alongside the SFU's DTLS role fix.

  **Publish negotiation was a check-then-act race.** `negotiatePublish()`
  read `signalingState`, then awaited `createOffer()`. The SFU's offer lands
  in that gap, and `setLocalDescription` then throws `Called in wrong state:
have-remote-offer` — or the answer to a superseded offer throws `Called in
wrong state: stable`. Either way the publish never negotiated: the sender
  existed, its m-section stayed `recvonly`, and the room saw no media while
  the SDK reported `camera published`. Every operation that touches the
  signaling state machine now runs on one chain, and local changes request an
  offer rather than making one, so any number of them coalesce into a single
  round trip. Glare resolves politely — the SFU's offer wins, ours rolls back
  and is re-queued — and a server-side `NEGOTIATION_GLARE` re-queues instead
  of being logged and dropped. No timers anywhere; `setTimeout(0)` is gone
  from the publish path.

  **A reconnect left the room silent.** `published` mixed desired state with
  the `RTCRtpSender` of a connection that no longer existed, and nothing
  re-published onto the replacement. Desired state and connection state are
  now separate: rejoining re-adds every live publication, re-declares its
  source to the new SFU session, and renegotiates once. A screen share whose
  capture ended during the outage is dropped instead — the track is dead and
  only the user can start a new one — and reports
  `localTrackUnpublished`.

  **The data channel could not bootstrap itself.** `openDataChannel()`
  created a channel and negotiated nothing, so the first `sendData()` threw
  "The data channel is not open yet" unless a media publish happened to carry
  the channel along. Creating the channel now requests the renegotiation it
  needs, `sendData()` awaits it internally, and payloads sent meanwhile are
  queued and delivered in order. `await room.join()` then
  `await room.sendData(payload)` works in an empty room. A connection that
  dies first rejects with `CONNECTION_FAILED` rather than hanging.

  **Application-provided tracks have a way in.** `LocalTrack` and
  `LocalTrackDelegate` are public, so a hand-built track looked publishable
  and was refused. New `createCustomTrack(mediaStreamTrack, { source })`,
  also on the client as `client.createCustomTrack()`, wraps a track the
  application already has — `canvas.captureStream()`, a Web Audio graph, a
  decoded file, a virtual camera — in a real internal delegate. What
  `publish()` accepts is unchanged; its refusal now names the way through.

## 0.2.0

### Minor Changes

- [#40](https://github.com/atulsinghhhh/Raven/pull/40) [`d7f48ea`](https://github.com/atulsinghhhh/Raven/commit/d7f48ea4294a36c7fd6d60ebff0f5b32820101e9) Thanks [@atulsinghhhh](https://github.com/atulsinghhhh)! - RTC tokens can now be revoked, and two server errors reach you as their own
  typed codes instead of a generic one.

  `DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}` revokes a minted token
  before it expires. Be clear about the boundary, because it is deliberate:
  revocation refuses the token for anything _new_ — the next signaling connect
  and the next telemetry call fail with `TOKEN_REVOKED` — and does **not** hang
  up a session already running on it. Authorization is checked when a
  connection is established, not re-checked per frame, so a participant who
  joined a moment earlier stays until they leave or their next reconnect fails.
  Close the room (`DELETE /v1/rooms/{roomId}`) to cut a live session. A short
  `ttlSeconds` therefore still does more to contain a leaked token than
  revocation does; revocation is the second control, not a replacement.

  Revocation is keyed by the token's `jti` — which is the `rtc_tokens` row id
  already returned as `id` from the mint — and the tombstone expires with the
  token, so nothing accumulates and no bearer token is ever stored. Same design
  as chat's, rather than a second mechanism.

  On the SDK side, `RTCErrorCode` gains `TOKEN_REVOKED` and
  `USAGE_LIMIT_EXCEEDED`. The second is the one worth noticing: running out of
  included Raven minutes previously surfaced as `SIGNALING_ERROR`, which is
  indistinguishable from signaling actually breaking. It is the one join
  failure whose remedy is commercial rather than technical, so an application
  can now show a billing prompt instead of a retry button. Both are treated as
  terminal for reconnect purposes: neither a backoff nor a fresh token can fix
  a revoked credential or an exhausted allowance.

### Patch Changes

- [#38](https://github.com/atulsinghhhh/Raven/pull/38) [`3dd03cc`](https://github.com/atulsinghhhh/Raven/commit/3dd03cccaca678e507c9ab67b93bc21357232b52) Thanks [@atulsinghhhh](https://github.com/atulsinghhhh)! - `@ravenkash/rtc`'s `assertTokenMatchesRoom()` now actually works.

  It decoded the room from `video.room`, which was LiveKit's token claim
  shape. Raven's own signer emits `rid` (room id) and `rnm` (room name), so
  the claim read back `undefined` and the check silently passed every room —
  `client.join('anything')` proceeded to a connection that then failed at the
  signaling gateway. It now reads `rid`/`rnm` and accepts either, which is
  what the claim comment in the control plane always said it would.

  This is versioned as a patch. The note that previously stood here — that
  the `@ravenkash/*` packages had never been published, so nobody could have
  observed the broken behaviour — was wrong by the time it was written:
  `@ravenkash/rtc@0.1.0` is on npm and has been, so the broken `video.room`
  claim read did ship.

- [#40](https://github.com/atulsinghhhh/Raven/pull/40) [`d7f48ea`](https://github.com/atulsinghhhh/Raven/commit/d7f48ea4294a36c7fd6d60ebff0f5b32820101e9) Thanks [@atulsinghhhh](https://github.com/atulsinghhhh)! - `@ravenkash/rtc` and `@ravenkash/client` are installable again.

  Both shipped at 0.1.0 with the workspace protocol still in their published
  manifests — `"@ravenkash/effects": "workspace:*"` for `rtc`, plus
  `"@ravenkash/chat"` and `"@ravenkash/rtc"` for `client`. The packages were
  public and downloadable the whole time; they just could not be installed by
  anyone outside this repo:

  ```
  npm  install @ravenkash/rtc → EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"
  pnpm add     @ravenkash/rtc → ERR_PNPM_WORKSPACE_PKG_NOT_FOUND @ravenkash/effects@workspace:*
  ```

  That made step 2 of the documented quickstart — `npm install @ravenkash/rtc`
  — impossible to follow, while `@ravenkash/server` installed fine, so the
  break only showed up once a developer got as far as the browser half.

  No source change was needed: `workspace:*` is correct in the repo, and pnpm
  rewrites it to a concrete version when it packs. The 0.1.0 tarballs were
  published by hand with `npm publish`, which rewrites nothing and bypassed
  every gate in `.github/workflows/release.yml`. Three gates now cover that
  path — a `prepublishOnly` guard in each package that refuses an npm-driven
  publish, a packed-tarball inspection that reads the manifest npm would
  actually receive, and a metadata check that fails a package using the
  protocol without the guard wired up.

  0.1.0 stays on the registry as-is; npm unpublish is restricted to 72 hours
  and that window is long closed. Anyone stuck on it can use an npm
  `overrides` entry pinning `@ravenkash/effects` to `0.1.0` until 0.1.1 lands.

- [#40](https://github.com/atulsinghhhh/Raven/pull/40) [`0797ed2`](https://github.com/atulsinghhhh/Raven/commit/0797ed2d9d07c1fc3defad08ac3cbab8ad00bfa4) Thanks [@atulsinghhhh](https://github.com/atulsinghhhh)! - Media now negotiates for the first participant in a room.

  The SFU took the DTLS client role when answering and the server role when
  offering, on the same peer connection. Since it offers at join and answers
  when a client publishes, the first participant in any room hit both in that
  order: it answered the join offer `active`, then the SFU's answer to its
  publish also said `active`. That asks both peers to swap DTLS roles
  mid-session, which is not a thing a transport can do — Chrome rejected the
  answer with "Failed to set SSL role for the transport", the publish never
  negotiated, and the participant sent and received nothing while the SDK
  cheerfully logged "camera published".

  Later joiners were unaffected: they answer an SFU offer first and happen to
  line up, which is why this looked intermittent rather than deterministic.

  `services/sfu` now pins its answering DTLS role to server
  (`SetAnsweringDTLSRole`), so the client is the DTLS client and the SFU the
  DTLS server whichever side offered. `docs/rtc/signaling.md` documents that
  as part of the protocol.

  The versioned part is `@ravenkash/rtc`, which no longer discards the
  browser's reason when it cannot answer an offer. It reported a bare "Could
  not answer the server's offer", which said that renegotiation broke but not
  why — and renegotiation is exactly where a role or m-line mismatch shows
  up. The underlying message is now included.

  `services/sfu` is not a published package, so the fix itself is not
  versioned here.
