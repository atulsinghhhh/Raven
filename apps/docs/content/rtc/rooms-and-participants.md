---
title: Rooms & Participants
description: Participant state, device selection, sending data, and the track model — on Web, React, React Native, and Flutter.
---

## Participants

<Tabs>
<Tab title="Web">

```ts
room.localParticipant.identity; // this session's own identity
room.localParticipant.tracks;   // LocalTrack[] currently published

room.remoteParticipants;        // RemoteParticipant[]
participant.identity;
participant.metadata;           // opaque, set when the token was minted
participant.tracks;             // RemoteTrack[] currently subscribed

room.on('participantJoined', (participant) => {});
room.on('participantLeft', (participant) => {});
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useLocalParticipant, useRemoteParticipants, useParticipants } from '@corvidhq/react';

function Roster() {
  const local = useLocalParticipant();
  const remote = useRemoteParticipants();
  const everyone = useParticipants(); // local first, then remote — the order a grid renders in

  return everyone.map((p) => <p key={p.identity}>{p.identity}</p>);
}
```

Each hook re-renders only when its own slice changes — `useRemoteParticipants()` doesn't re-render on a local mute.

</Tab>
<Tab title="React Native">

```tsx
import { useParticipants, useRemoteParticipants } from '@corvidhq/react-native';

function Roster({ room }) {
  const everyone = useParticipants(room);
  return everyone.map((p) => <Text key={p.identity}>{p.identity}</Text>);
}
```

Takes `room` directly rather than reading it from context — see
[React Native SDK](/sdk/react-native) for why.

</Tab>
<Tab title="Flutter">

```dart
room.localParticipant.identity;
room.remoteParticipants; // List<RavenParticipant>
room.participants;       // local first, then remote

room.participantChanges.listen((participants) {
  // rebuild — fires on join/leave and on any track change
});
```

</Tab>
</Tabs>

`metadata` is whatever your backend attached when it minted the token —
Raven never inspects or interprets it.

## Device selection

Web-only — React Native and Flutter select devices through the OS,
not a JavaScript device-enumeration API.

```ts
const devices = await client.getDevices();
// { deviceId, label, kind }[] — kind: 'videoinput' | 'audioinput' | 'audiooutput'
// labels are populated only once permission has been granted at least once

await room.setCameraDevice(deviceId);
await room.setMicrophoneDevice(deviceId);
await room.setSpeakerDevice(deviceId); // where the browser supports setSinkId — not Safari; throws DEVICE_NOT_FOUND there

const unsubscribe = client.onDeviceChange(() => {
  // re-enumerate — a camera or mic was connected or disconnected
});
```

On React Native, the closest equivalent is switching front/rear camera
— see [Flutter's `switchCamera()`](/sdk/flutter#camera-microphone-screen-share) for the Dart SDK's version of the same phone-only concern.

## Sending data

<Tabs>
<Tab title="Web">

```ts
await room.sendData('hello'); // string or Uint8Array

room.on('dataReceived', (payload, participant) => {
  console.log(new TextDecoder().decode(payload), participant?.identity);
});
```

</Tab>
<Tab title="React Native">

```ts
await room.sendData('hello');

room.on('dataReceived', (payload, participant) => {
  console.log(new TextDecoder().decode(payload), participant?.identity);
});
```

The same `Room` class as web — no React Native-specific data API.

</Tab>
</Tabs>

Requires the token's `publishData` grant — throws `PERMISSION_DENIED`
otherwise. Deliberately minimal: no reliability options, no
per-participant targeting. If you need routed, ordered, or persisted
messages between participants, that's what [Chat](/chat) is for
— it's a first-class service, not a fallback bolted onto the data
channel.

## Track model

```
Track   (base: kind, mediaStreamTrack, mediaStream, isMuted, attach(), detach())
  ├── LocalTrack   (+ mute(), unmute(), stop())
  └── RemoteTrack
```

<Tabs>
<Tab title="Web">

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

</Tab>
<Tab title="React">

```tsx
import { ParticipantView } from '@corvidhq/react';
<ParticipantView participant={participant} />
```

`<ParticipantView>` wraps attach/detach for you — an optional,
genuinely optional component; the hooks work with any UI you build
instead.

</Tab>
<Tab title="React Native">

```tsx
import { RavenVideoView } from '@corvidhq/react-native';
<RavenVideoView participant={participant} room={room} style={{ flex: 1 }} />
```

Pass `room` and the view follows track changes — published,
unpublished, muted, resubscribed — by itself.

</Tab>
<Tab title="Flutter">

```dart
RavenVideoView(
  participant: participant,
  room: room, // enables automatic updates
  kind: RavenTrackKind.camera,
  fit: RavenVideoFit.cover,
)
```

Disposes its native texture with the widget — dropping `room` is how a
scrolling grid leaks a native view per rebuild.

</Tab>
</Tabs>

## Common errors

| Error | Why | Fix |
|---|---|---|
| `PERMISSION_DENIED` on `sendData()` | Token was minted without `publishData`. | Set `publishData: true` when calling `tokens.create()`. |
| `DEVICE_NOT_FOUND` on `setSpeakerDevice()` | Browser doesn't support `setSinkId` (Safari). | Fall back to system output selection — there's no workaround. |

## Related

- [Audio & Video](/rtc/audio-and-video) — enabling the devices whose tracks show up here.
- [RTC → Overview](/rtc) — the full event list.
- [Chat](/chat) — for anything data messages are too minimal for.
