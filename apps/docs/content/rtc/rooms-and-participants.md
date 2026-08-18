---
title: Rooms & Participants
description: Participant state, device selection, and sending data.
---

## Participants

```ts
room.localParticipant.identity; // this session's own identity
room.localParticipant.tracks;   // LocalTrack[] currently published

room.remoteParticipants;        // RemoteParticipant[]
participant.identity;
participant.metadata;           // opaque, set when the token was minted
participant.tracks;             // RemoteTrack[] currently subscribed
```

`metadata` is whatever your backend attached when it minted the token —
Raven never inspects or interprets it.

## Device selection

```ts
const devices = await client.getDevices();
// { deviceId, label, kind }[] — kind: 'videoinput' | 'audioinput' | 'audiooutput'
// labels are populated only once permission has been granted at least once

await client.setCameraDevice(deviceId);
await client.setMicrophoneDevice(deviceId);
await room.setSpeakerDevice(deviceId); // where the browser supports setSinkId — not Safari; throws DEVICE_NOT_FOUND there

const unsubscribe = client.onDeviceChange(() => {
  // re-enumerate — a camera or mic was connected or disconnected
});
```

## Sending data

```ts
await room.sendData('hello'); // string or Uint8Array

room.on('dataReceived', (payload, participant) => {
  console.log(new TextDecoder().decode(payload), participant?.identity);
});
```

Requires the token's `publishData` grant — throws `PERMISSION_DENIED`
otherwise. Deliberately minimal: no reliability options, no
per-participant targeting. If you need routed, ordered, or persisted
messages between participants, that's what [Chat](/chat/overview) is for
— it's a first-class service, not a fallback bolted onto the data
channel.

## Track model

```
Track   (base: kind, mediaStreamTrack, mediaStream, isMuted, attach(), detach())
  ├── LocalTrack   (+ mute(), unmute(), stop())
  └── RemoteTrack
```

`track.attach()` / `track.attach(existingElement)` and `track.detach()`
are the SDK's only media-element helpers — it's an SDK, not a UI
component library:

```ts
room.on('trackSubscribed', (track, participant) => {
  videoElement.appendChild(track.attach());
});

room.on('trackUnsubscribed', (track) => {
  track.detach().forEach((el) => el.remove());
});
```
