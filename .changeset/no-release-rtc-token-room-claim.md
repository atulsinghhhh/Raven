---
"@ravenkash/rtc": patch
---

`@ravenkash/rtc`'s `assertTokenMatchesRoom()` now actually works.

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
