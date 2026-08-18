# WebRTC Fundamentals

This document exists so that every future contributor (and Claude Code, in
later phases) shares the same mental model of WebRTC before we integrate
LiveKit. We are not implementing any of this ourselves — LiveKit and coturn
own all of it — but the control plane, SDK, and support engineering all need
to reason about it correctly.

## The problem WebRTC solves

Two browsers (or a browser and a server) need to exchange audio, video, and
data in real time, with the lowest possible latency, across NATs, firewalls,
and unreliable networks, without a plugin.

## Core building blocks

### SDP (Session Description Protocol)
A text format describing what a peer wants to send/receive: codecs,
resolutions, encryption keys, network candidates. Peers exchange an
**offer** and an **answer** during signaling to agree on a common session
shape. We never hand-construct or parse SDP — LiveKit's client/server SDKs
do this internally.

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
used for congestion control and adaptive bitrate. This is entirely inside
LiveKit's media path.

### DTLS / SRTP
DTLS performs a TLS-style handshake over UDP to derive encryption keys.
SRTP then encrypts the actual RTP media using those keys. All WebRTC media
is encrypted by default — there is no unencrypted mode. LiveKit and browsers
handle this transparently.

### SFU (Selective Forwarding Unit)
A media server that receives one upload per publisher and forwards
(selectively, per-subscriber) copies to every other participant, instead of
every participant uploading N-1 times (full mesh). This is what makes group
calls scale. See `sfu-comparison.md` for why we chose LiveKit as our SFU.

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

## How our system uses these pieces

```
Browser/Mobile SDK
      |
      | 1. Request an access token from our Control Plane (HTTPS)
      v
Control Plane (our code) --- issues a scoped, short-lived LiveKit token
      |
      | 2. Connect to LiveKit using that token (LiveKit's own WS protocol)
      v
LiveKit signaling — SDP offer/answer + ICE candidates exchanged here
      |
      | 3. ICE negotiation: try STUN-derived direct path, else TURN relay
      v
STUN (candidate discovery) / coturn (relay when needed)
      |
      v
LiveKit SFU — receives publisher tracks, forwards to subscribers
      |
      +---- Participant A
      +---- Participant B
      +---- Participant C
```

Our control plane never touches SDP, ICE, RTP, or encryption. Its job stops
at "does this caller have a right to publish/subscribe in this room" and
"issue a token that proves that fact to LiveKit."
