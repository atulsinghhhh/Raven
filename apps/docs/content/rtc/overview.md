---
title: RTC Overview
description: Rooms, participants, and tracks — the shape of a Raven call.
---

Raven's RTC plane is built on [LiveKit](https://livekit.io). You never
touch SDP, ICE candidates, or `RTCPeerConnection` directly — the SDK's
job is to make those disappear.

## The shapes

```
Room                 one call session
  ├── localParticipant     this session's own identity and published tracks
  └── remoteParticipants   everyone else currently in the room

Track
  ├── LocalTrack     something this side captured (camera, mic, screen)
  └── RemoteTrack    something subscribed from a remote participant
```

Every track has a `kind`: `'camera' | 'microphone' | 'screenShare' |
'unknown'`. Data messages are not modeled as a track — see
[Rooms & Participants](/rtc/rooms-and-participants#data).

## Joining

```ts
import { createRTCClient } from '@raven/rtc';

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.livekitUrl,
  iceServers: resp.iceServers,
});

const room = await client.join('room-123');
```

`roomId` must match what the token was minted for. The SDK decodes (never
verifies — the server is the source of truth) the token client-side and
throws `ROOM_NOT_FOUND` immediately on a mismatch, rather than letting
you hit a confusing connection failure later.

Participants already in the room — and their already-subscribed tracks —
are available synchronously the moment `join()` resolves:

```ts
for (const participant of room.remoteParticipants) {
  for (const track of participant.tracks) {
    videoElement.appendChild(track.attach());
  }
}
```

`participantJoined`/`trackSubscribed` only fire for arrivals *after* this
point.

## Leaving

```ts
await room.leave();
```

Stops local tracks and closes the underlying connection. Safe to call
even if you're not sure you're still connected.

## Events

```ts
room.on('connectionStateChanged', (state) => {}); // connecting|connected|reconnecting|disconnected|failed
room.on('connected', () => {});
room.on('disconnected', () => {});
room.on('reconnecting', () => {});
room.on('reconnected', () => {});

room.on('participantJoined', (participant) => {});
room.on('participantLeft', (participant) => {});

room.on('trackPublished', (kind, participant) => {});
room.on('trackUnpublished', (kind, participant) => {});
room.on('trackSubscribed', (track, participant) => {});
room.on('trackUnsubscribed', (track, participant) => {});
room.on('trackMuted', (kind, participant) => {});
room.on('trackUnmuted', (kind, participant) => {});

room.on('localTrackPublished', (track) => {});
room.on('localTrackUnpublished', (track) => {});

room.on('dataReceived', (payload, participant) => {}); // Uint8Array
room.on('error', (error) => {});                       // RTCError
```

Unsubscribe with `room.off(event, handler)`.

## Errors

Every error is a typed `RTCError { code, message, cause }` — never a raw
`DOMException`:

```
INVALID_TOKEN | TOKEN_EXPIRED | ROOM_NOT_FOUND | CONNECTION_FAILED
PERMISSION_DENIED | CAMERA_PERMISSION_DENIED | MICROPHONE_PERMISSION_DENIED
DEVICE_NOT_FOUND | NETWORK_ERROR | SIGNALING_ERROR | MEDIA_ERROR | TIMEOUT
```

```ts
import { isRTCError } from '@raven/rtc';

try {
  await client.join('room-123');
} catch (error) {
  if (isRTCError(error)) console.log(error.code, error.message);
}
```

## Next

- [Rooms & Participants](/rtc/rooms-and-participants) — device selection,
  data messages, participant state.
- [Audio & Video](/rtc/audio-and-video) — camera, microphone, and the
  create-then-publish pattern.
- [Diagnostics](/rtc/diagnostics) — real per-track stats: RTT, jitter,
  packet loss, bitrate, codec.
