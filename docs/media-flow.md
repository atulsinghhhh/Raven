# Media Flow

```
Client A
   |
   | WebRTC (SDP/ICE negotiated via LiveKit's own signaling protocol)
   v
  SFU  (LiveKit)
   |
   | WebRTC
   v
Client B
```

This is the entire media path. Nothing else in the platform sits on it.

## Why media does not go through the API or the signaling server

**The control plane API** (`apps/api`'s REST endpoints, Phase 2) is a
Node.js HTTP server built on Express/NestJS. It has no WebRTC stack: no
ICE agent, no DTLS/SRTP, no RTP packet handling. There is no code path in
`ProjectsController`, `RoomsController`, or `RtcTokensController` that
could carry a video frame even by accident — the most it ever does with
"media" is mint a token that authorizes *someone else* (LiveKit) to carry
it. This isn't a convention being followed; it's architecturally
impossible for media to transit the API, because the API never holds a
media transport of any kind.

**The Phase 3 signaling gateway** (`/v1/rtc`, a raw WebSocket server in
the same Node.js process) is, likewise, a JSON message router — see
`apps/api/src/modules/signaling/messages/message-router.service.ts`. It
forwards SDP *text* and ICE candidate *JSON* between two connections; it
never opens a media transport, never touches RTP, and — per Phase 4's
architecture decision (`docs/sfu.md#resolving-the-phase-3-signaling-question`)
— isn't even used for the connections that carry real media in this
phase's demo. Even where it is used, forwarding an SDP blob is exchanging
a *description* of a media session, not the media itself, in the same
way mailing someone a floor plan isn't the same as mailing them the
building.

**The only thing in this platform that ever holds actual audio/video
bytes is LiveKit** — a purpose-built C/Go media server with a real ICE
agent, DTLS/SRTP stack, and RTP forwarding engine, run as its own process
(`raven-livekit` in `docker-compose.yml`) with dedicated UDP/TCP ports
that never touch the API's Node.js event loop.

## The full connection, annotated

```
Client                          Control Plane (API)              LiveKit (SFU)
  |                                    |                                |
  |--- POST /v1/rooms/:id/rtc-tokens ->|                                |
  |    (API-key authenticated)         |                                |
  |                                    |--- mints JWT + TURN creds ---  |
  |<--- { token, livekitUrl,           |     (no network call to        |
  |       iceServers } ----------------|      LiveKit needed to do this)|
  |                                                                     |
  |======================= room.connect(livekitUrl, token) ============|
  |                                    |                                |
  |<================== LiveKit's own signaling (SDP/ICE) ==============|
  |                                    |                                |
  |======================= WebRTC media (RTP/SRTP) =====================|
  |                                    |                                |
```

The API is only ever in the *first* leg of this diagram — issuing a
credential — and is completely absent from every subsequent line. This
is why the control plane can be trivially horizontally scaled or
restarted without dropping a single active call: it was never holding
any state a call depends on to keep flowing.

## Where TURN fits in this picture

```
Direct (preferred):        Client --UDP--> LiveKit
Fallback (restrictive NAT): Client --TURN(coturn)--> LiveKit
```

Both paths are still pure WebRTC media — coturn relays encrypted
SRTP/RTP packets without being able to inspect their contents (that's
what the DTLS/SRTP encryption is for); it's a NAT-traversal relay, not a
media-aware component. See `docs/architecture/turn.md` and
`docs/sfu.md#turn-integration`.
