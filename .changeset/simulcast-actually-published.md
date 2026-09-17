---
'@ravenkash/rtc': minor
---

Publish real simulcast, and make adaptiveStream real

Simulcast had never once reached the wire. `applySimulcast()` called
`pc.addTrack()` and then tried to attach a three-layer ladder with
`sender.setParameters()`. That cannot work: the WebRTC specification
requires implementations to reject a change to a sender's *number* of
encodings, and RIDs only appear in the SDP when they were present before
the offer was generated, which `setParameters` is by definition too late
for. The rejection went to `logger.debug` and nowhere else, so every
published camera sent a single full-resolution layer while the SDK
believed it was sending three.

The consequence was paid by subscribers. With only one layer to forward,
the SFU handed every subscriber the publisher's full-quality stream
regardless of how small it was being rendered — which is what makes a six-
or eight-person call cost every participant the full bitrate of every
other participant.

**A camera is now published through `pc.addTransceiver()` with
`sendEncodings` declared at creation**, the only point at which a ladder
can be declared. The offer carries `a=simulcast:send low;medium;high` and
three `a=rid:` lines, and the SFU answers `a=simulcast:recv`. The comment
claiming the SFU could not answer a client offer that adds m-sections was
stale — `Participant.AcceptOffer` has always done a plain
`SetRemoteDescription` + `CreateAnswer`, and rejects only on glare.

**`adaptiveStream` is new, on by default, and does something.** Each
subscribed video is kept on the smallest layer that still covers the
element it is attached to, measured with a `ResizeObserver` from
`RemoteTrack.attach()`. Thresholds (240 / 640 CSS pixels) and hysteresis
match the Flutter SDK exactly, so a call does not render at different
quality on a phone and a laptop for no discoverable reason. Set
`adaptiveStream: false` to manage layers yourself.

**`RemoteTrack.setLayer(layer)` is new**, and it *pins*: adaptive
streaming will not move a track you have chosen a layer for. Pass
`'auto'` to release the pin.

**`Room.simulcastStatus(kind)` is new.** It reads the ladder back off the
negotiated sender rather than reporting what was requested — the
distinction the previous implementation could not make. A browser that
refuses the ladder reports `'unsupported'`, logs a warning, and still
publishes a single layer.

Failures are no longer swallowed: a simulcast configuration that does not
survive negotiation logs at `warn` and is reported through
`Room.simulcastStatus()`.
