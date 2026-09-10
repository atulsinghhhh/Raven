# WebRTC Fundamentals

> **This is a primer, not a description of Livqeno.** It explains WebRTC
> itself — the standards, the vocabulary, the parts a real connection is
> made of. That has not changed and will not. For how *Livqeno* is put
> together, read [`../rtc/architecture.md`](../rtc/architecture.md).

This document exists so everyone working on Livqeno shares the same mental
model of WebRTC. Livqeno implements a fair amount of it now — the SFU side —
but the standards below are still standards, and the control plane, SDKs,
and support engineering all need to reason about them correctly.

Notably, Livqeno does **not** implement any of the transport-level pieces:
ICE, DTLS, SRTP and SCTP come from [Pion](https://github.com/pion/webrtc)
on the server and from the browser on the client. What Livqeno writes is the
layer above — which tracks go to whom, and why.

## The problem WebRTC solves

Two browsers (or a browser and a server) need to exchange audio, video, and
data in real time, with the lowest possible latency, across NATs, firewalls,
and unreliable networks, without a plugin.

## Core building blocks

### SDP (Session Description Protocol)
A text format describing what a peer wants to send/receive: codecs,
resolutions, encryption keys, network candidates. Peers exchange an
**offer** and an **answer** during signaling to agree on a common session
shape. Livqeno never hand-constructs SDP: Pion generates it on the server,
the browser generates it on the client. Livqeno *reads* one line of it —
`a=msid:`, to learn the remote track id of an arriving track, because
`RTCTrackEvent.track.id` is a locally-minted id and not the remote one.

### ICE (Interactive Connectivity Establishment)
The negotiation process that finds a usable network path between two peers.
Each side gathers **candidates** (local IP, server-reflexive IP via STUN,
relay address via TURN) and tries them in priority order until one connects.
ICE is why WebRTC works despite NAT — it doesn't assume a direct route exists.

### STUN (Session Traversal Utilities for NAT)
A lightweight protocol a client uses to ask a public server "what is my
public IP:port as seen from the internet?" This produces a
**server-reflexive candidate**, which often allows two peers behind
ordinary NATs to connect directly without relaying traffic. STUN never
carries media — it's a discovery step only.

### TURN (Traversal Using Relays around NAT)
When direct connectivity is impossible (symmetric NAT, restrictive
corporate firewalls, UDP blocked), a TURN server relays media between
peers. Unlike STUN, **TURN is on the media path** — every byte of audio/
video passes through it, so TURN bandwidth is a real, billable
infrastructure cost, not just a discovery cost. We use coturn.

### RTP / RTCP (Real-time Transport Protocol / Control Protocol)
RTP carries the actual encoded audio/video frames once a session is
established. RTCP carries feedback (packet loss, jitter, receiver reports)
used for congestion control and adaptive bitrate.

Livqeno's SFU works directly with both: it rewrites RTP sequence numbers and
timestamps when switching a subscriber between simulcast layers, and it
relays a subscriber's RTCP keyframe requests (PLI/FIR) back to the
publisher. Getting that relay wrong is a classic SFU bug whose symptom is
"video sometimes never recovers after a network blip". See
[`../rtc/sfu.md#recovery-rtprtcp`](../rtc/sfu.md#recovery-rtprtcp).

### DTLS / SRTP
DTLS performs a TLS-style handshake over UDP to derive encryption keys.
SRTP then encrypts the actual RTP media using those keys. All WebRTC media
is encrypted by default — there is no unencrypted mode, and Livqeno does not
add one. Pion and the browser handle this transparently; Livqeno's only
involvement is that the SFU offers `a=setup:actpass`, letting the answerer
pick the DTLS role.

### SFU (Selective Forwarding Unit)
A media server that receives one upload per publisher and forwards
(selectively, per-subscriber) copies to every other participant, instead of
every participant uploading N-1 times (full mesh). This is what makes group
calls scale, and it is what Livqeno's `services/sfu` is.

`sfu-comparison.md` records why a third-party SFU was the right first
choice; [`native-rtc-migration-map.md`](./native-rtc-migration-map.md#4-technology-decision)
records why Livqeno now runs its own.

### Simulcast
A publisher sends multiple encoded qualities (e.g. low/medium/high) of the
same track simultaneously. The SFU picks which quality to forward to each
subscriber based on that subscriber's bandwidth/CPU, without needing to
transcode. This is a major cost and quality lever — transcoding is CPU-
expensive, simulcast forwarding is not.

### Congestion control / adaptive bitrate
Endpoints continuously estimate available bandwidth (via RTCP feedback,
transport-wide congestion control) and adjust encoding bitrate or simulcast
layer selection accordingly, so a bad network degrades quality instead of
breaking the call.

## How Livqeno uses these pieces

```
Browser / Mobile SDK
      |
      | 1. Ask your own backend for an access token; it asks Livqeno's
      |    Control Plane over HTTPS with a project API key.
      v
Livqeno Control Plane --- issues a scoped, short-lived RTC token
      |
      | 2. Connect to Livqeno's own signaling WebSocket (/v1/rtc) with it.
      v
Livqeno Signaling — SDP offer/answer + ICE candidates, between the client
      |             and the SFU node serving its room. The server is a
      |             party to the negotiation, not a courier.
      | 3. ICE: try the direct path, then STUN-derived, then TURN relay.
      v
STUN (candidate discovery) / coturn (relay when needed)
      |
      v
Livqeno SFU (Go/Pion) — receives publisher tracks, forwards to subscribers
      |
      +---- Participant A
      +---- Participant B
      +---- Participant C
```

Two things are worth pulling out of that diagram.

**The control plane still never touches SDP, ICE, RTP, or encryption.**
Its job stops at "may this caller publish or subscribe in this room", and
that has not changed — what changed is that the thing on the other side of
the token is Livqeno's own SFU rather than a third party's. Media never
passes through the API.

**A client is never told the SFU's address.** It learns the node's *name*,
for support and diagnostics. That is what allows the media plane to be
re-shaped, re-scaled, or reimplemented without an SDK release — and it is
the property that made replacing the SFU underneath this diagram possible
at all.

See [`../rtc/architecture.md`](../rtc/architecture.md) for the real
detail: who offers, how glare is resolved, how simulcast layers are
chosen, what happens on reconnect.
