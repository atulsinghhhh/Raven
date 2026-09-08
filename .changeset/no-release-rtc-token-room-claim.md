---
---

`@ravenkash/rtc`'s `assertTokenMatchesRoom()` now actually works.

It decoded the room from `video.room`, which was LiveKit's token claim
shape. Raven's own signer emits `rid` (room id) and `rnm` (room name), so
the claim read back `undefined` and the check silently passed every room —
`client.join('anything')` proceeded to a connection that then failed at the
signaling gateway. It now reads `rid`/`rnm` and accepts either, which is
what the claim comment in the control plane always said it would.

Not versioned by this changeset: the `@ravenkash/*` packages have never been
published, so nobody has ever observed the broken behaviour, and the first
release should still be 0.1.0 rather than 0.1.1.
