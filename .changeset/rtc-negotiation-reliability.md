---
'@ravenkash/rtc': minor
---

Serialize negotiation, restore media across reconnects, bootstrap the data channel, and support application-provided tracks

Four RTC reliability fixes, all in the browser SDK. Found during the same
isolated static-page test as the SFU's DTLS role fix, which is unchanged.

**Publish negotiation was a check-then-act race.** `negotiatePublish()` read
`signalingState` and then awaited `createOffer()`. The SFU's offer lands in
that gap, and `setLocalDescription` throws `Called in wrong state:
have-remote-offer`; an answer to a superseded offer throws `Called in wrong
state: stable`. Either way the publish never negotiated — the sender
existed, its m-section stayed `recvonly`, and the room saw no media while
the SDK reported `camera published`.

Every operation that touches the signaling state machine now runs on one
chain: remote offers, remote answers, our own offers, remote candidates.
Nothing else goes near `setLocalDescription` / `setRemoteDescription`.
Offers are triggered by the browser's own `negotiationneeded` event rather
than by an SDK-side flag, which matters more than it sounds: the browser's
bit clears when *any* description covers the change, including one the SFU
offered, and a flag that cannot know that re-offers forever. Glare resolves
politely — the SFU's offer wins, ours rolls back, and the browser decides
whether a retry is warranted. A server-side `NEGOTIATION_GLARE` now waits
for the SFU's offer as the SFU's own message instructs, instead of retrying
straight into another refusal.

One extra guard sits alongside the browser's bit: Livqeno's SFU identifies a
published track by the id in the SDP `msid` and matches it to the
`track.publish` declaration that says camera or screen share. A track can
be sending on a transceiver whose m-section still announces an msid
inherited from the SFU's offer, so the SDK offers once more to put its own
ids on the wire, then stops asking and logs a warning if the browser will
not. `setTimeout` is gone from the publish path entirely.

**A reconnect left the room silent.** `published` mixed desired state with
the `RTCRtpSender` of a connection that no longer existed, and nothing
re-published onto the replacement — both transceivers came back `inactive`
with no senders. Desired state and connection state are now separate:
rejoining re-adds every live publication, re-declares its source to the new
SFU session, re-creates the data channel if one was in use, and renegotiates
once. A screen share whose capture ended during the outage is dropped
instead, with `localTrackUnpublished`, because only the user can start a new
one.

**The data channel could not bootstrap itself.** `openDataChannel()` created
a channel and negotiated nothing, so the first `sendData()` threw "The data
channel is not open yet" unless a media publish happened to carry the
channel along. Creating the channel now drives the renegotiation it needs,
`sendData()` waits for the channel internally, and payloads sent meanwhile
are queued and delivered in order — so `await room.join()` then
`await room.sendData(payload)` works in an empty room with nothing
published. A connection that dies first rejects with `CONNECTION_FAILED`
rather than hanging. Receiving needed the same treatment: the SFU fans data
out over each recipient's own channel, so listening for `dataReceived` now
provisions one. Without that, a page that never sent could not receive.

**Application-provided tracks have a way in.** `LocalTrack` and
`LocalTrackDelegate` are public, so a hand-built track looked publishable
and was refused. New `createCustomTrack(mediaStreamTrack, { source })`, also
`client.createCustomTrack()`, wraps a track the application already has —
`canvas.captureStream()`, a Web Audio graph, a decoded file, a virtual
camera — in a real internal delegate. What `publish()` accepts is unchanged;
its refusal now names the way through.
