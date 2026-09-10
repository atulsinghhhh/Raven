---
'@ravenkash/rtc': minor
---

Serialize negotiation, restore media across reconnects, bootstrap the data channel, and support application-provided tracks

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
