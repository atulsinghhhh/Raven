---
title: Signaling Protocol
description: The RTC signaling wire contract — for a client where Livqeno ships no SDK, or for reading what is actually on the socket.
---

You do not need this page to use Livqeno. `@ravenkash/rtc`, the React Native
SDK and `raven_rtc` all speak this protocol so you do not have to, and the
SDK is the supported interface.

This is for writing a client in a language Livqeno does not ship, or for
reading frames in devtools.

## Endpoint

```
wss://<your-raven-host>/v1/rtc?token=<rtc token>
```

The token goes in the query string because the browser WebSocket API
cannot set headers on an upgrade. Always `wss://` in production — a token
in a URL over cleartext is a credential in cleartext.

## This is an SFU protocol, not peer-to-peer

The single most important thing to understand, especially if you are
reading older material.

**Every client has exactly one peer: the media server serving its room.**
The server is a party to the negotiation, not a courier between browsers.
So no negotiation frame names a target participant — there is only ever one
counterparty.

This replaced a full-mesh protocol where every SDP and ICE message carried
a `targetParticipantId`. Several frame *names* survived that change and
their meanings did not. If you find a document describing `sdp.offer` as
something the server forwards from another browser, it is describing a
protocol that no longer exists.

## Frames

Every frame is a JSON object with a `type`. Flat fields, no envelope.

### Client → server

| Type | Fields | Notes |
|---|---|---|
| `room.join` | `roomId?`, `region?` | Sent first. If `roomId` is present it must **match the token**, not override it |
| `room.leave` | — | Explicit leave |
| `sdp.answer` | `sdp` | Answering the server's offer. The common case — the server offers first |
| `sdp.offer` | `sdp` | A client-initiated offer, sent when the client starts publishing |
| `ice.candidate` | `candidate` | Trickled |
| `track.mute` | `muted`, `source` | Mute/unmute a track you publish, without unpublishing |
| `track.publish` | `source` | Declares what a track is *of*: `camera`, `microphone` or screen share |
| `subscription.update` | `publisherId`, `trackId`, `layer` | Ask for a simulcast layer: `low`, `medium`, `high`, `auto` |
| `ping` | — | Application-level keepalive |

`track.publish` exists because WebRTC has no notion of a source and a page
cannot choose the ids that land in the SDP — both are read-only. Without
the declaration the server can only guess from codec kind, which cannot
tell a screen share from a camera.

### Server → client

| Type | Carries |
|---|---|
| `room.joined` | `roomId`, the current participants and their published tracks |
| `room.left` | `roomId` |
| `participant.joined` | The participant who joined |
| `participant.left` | The participant who left |
| `track.published` | Someone started publishing |
| `track.unpublished` | Someone stopped |
| `track.muted` / `track.unmuted` | A publisher muted a track they still publish |
| `sdp.offer` | An offer from the server. Sent on join, and whenever the room's track set changes |
| `sdp.answer` | The server's answer to a client-initiated offer |
| `ice.candidate` | Trickled from the server |
| `connection.state` | Real ICE and DTLS progress **as the server sees it** — not inferred from this socket's health |
| `error` | `code`, `message` |
| `pong` | Reply to `ping` |

**Unknown types must be ignored, not rejected.** A newer server may send a
frame an older client does not know; throwing on one breaks a client across
an upgrade it did not ask for.

## Negotiation

```
→  (upgrade with ?token=…)
→  {"type":"room.join"}
←  {"type":"room.joined","roomId":"…","participants":[…]}
←  {"type":"sdp.offer","sdp":"v=0…"}
→  {"type":"sdp.answer","sdp":"v=0…"}
→  {"type":"ice.candidate","candidate":{…}}
←  {"type":"ice.candidate","candidate":{…}}
←  {"type":"connection.state","state":"connected"}
```

The server offers first. When you start publishing you may send your own
offer — and if the server already has one in flight you get
`NEGOTIATION_GLARE`, which **is** retryable: answer the offer already
arriving, then retry.

## Heartbeat

Send `ping` every **30 seconds**. A connection with no traffic for
**60 seconds** — one missed cycle — is terminated.

## Errors

15 codes, on an `error` frame:

`INVALID_TOKEN`, `TOKEN_EXPIRED`, `UNAUTHORIZED`, `ROOM_NOT_FOUND`,
`ROOM_FULL`, `INVALID_MESSAGE`, `INVALID_MESSAGE_TYPE`,
`PARTICIPANT_NOT_FOUND`, `NOT_IN_ROOM`, `PERMISSION_DENIED`,
`RATE_LIMITED`, `NO_RTC_CAPACITY`, `RTC_SERVER_UNREACHABLE`,
`NEGOTIATION_FAILED`, `NEGOTIATION_GLARE`.

Which are retryable, and what each means, is in
[Errors](/reference/errors#signaling-errors).

This vocabulary is **not** the `RAVEN_*` HTTP namespace. The signaling
socket is a separately versioned wire protocol and keeps its own codes, for
the same reason the chat socket does.

## Limits

| Limit | Default | Variable |
|---|---|---|
| Frame size | 16 KB | `SIGNALING_MAX_MESSAGE_BYTES` |
| Messages per connection, per window | 100 / 10s | `SIGNALING_MAX_MESSAGES_PER_WINDOW` |
| Connection attempts per IP, per window | 20 | `SIGNALING_MAX_CONNECTIONS_PER_WINDOW` |
| Participants per room | 50 | `SIGNALING_MAX_PARTICIPANTS_PER_ROOM` |

The per-message limiter is in-memory and per-socket. The connection
limiter is Redis-backed and per-IP, because it guards the upgrade
handshake — before any token has been verified.

## What you never learn

Which media server you got. Clients connect here and Livqeno allocates on
their behalf. That indirection is what let Livqeno's media plane be replaced
wholesale without an SDK release, and it means there is no server address
to configure.

## Next steps

- [Events](/rtc/events) — the typed form of these frames.
- [Errors](/reference/errors#signaling-errors) · [Running the SFU](/self-hosting/sfu)
- [Chat WebSocket protocol](/chat/websocket) — the other socket, deliberately a different protocol.
