---
'@ravenkash/rtc': patch
---

Take a publication's id from the SDP, not from the local track

`0.3.0` shipped the negotiation rework but not the correction that followed
it, so `reconcilePublicationIds()` was missing: the code landed on `main`
through #46 with no changeset of its own and would otherwise go out
undescribed.

Raven's SFU identifies a published track by the id in the SDP `msid`, and
matches that to the `track.publish` declaration saying camera or screen
share. A track can therefore be sending on a transceiver whose m-section
still announces an msid inherited from the SFU's own offer — Chrome will
not rewrite an id it did not author. When that happens the SFU falls back
to inferring the source from the codec kind, which reads a screen share as
a camera: the media arrives and plays, but a layout keyed on the announced
source puts the shared window in the face tile.

`reconcilePublicationIds()` reads the ids back off the answer and re-maps
publications onto what is actually on the wire. It offers once more to put
its own ids there, then stops and warns rather than standing in a loop,
because a permanent re-offer condition is the same treadmill the
negotiation rework removed.

Publishing each track on a transceiver of its own would settle the
ambiguity outright and is deliberately not done: this SFU does not answer
a client offer that adds m-sections, so the publish would never complete.
That needs an SFU-side change, and `rtc/screen-sharing.md` now records
what it costs until then.
