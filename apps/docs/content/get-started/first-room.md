---
title: Join your first room
description: Create a client from the mint response, join, publish media, and watch participants arrive.
---

Your backend has minted a token. This is everything the client does with it.

## Connect and join

<Tabs>
<Tab title="Web">

```ts
import { createRTCClient } from '@corvidhq/rtc';

// Whatever your own endpoint returns from raven.tokens.create().
const credentials = await fetch('/join-room', { method: 'POST' }).then((r) => r.json());

const client = createRTCClient(credentials);
const room = await client.join(credentials.roomId);
```

`createRTCClient` accepts the mint response directly — `token`, `endpoint`,
`iceServers` and `telemetryUrl` are read from it and the rest ignored.

</Tab>
<Tab title="React">

```tsx
'use client';
import { RavenRoom, useConnectionState, useParticipants } from '@corvidhq/react';

function Call({ credentials }) {
  return (
    <RavenRoom
      token={credentials.token}
      endpoint={credentials.endpoint}
      iceServers={credentials.iceServers}
      room={credentials.roomId}
    >
      <CallBody />
    </RavenRoom>
  );
}

function CallBody() {
  const state = useConnectionState();
  const participants = useParticipants();
  return <p>{state} · {participants.length} in room</p>;
}
```

</Tab>
<Tab title="React Native">

```ts
import { Raven } from '@corvidhq/react-native';

const raven = new Raven(credentials);
const room = await raven.join(credentials.roomId);
```

`new Raven(...)` installs the WebRTC globals and asks for camera and
microphone permission on join. See [Permissions](/rtc/permissions).

</Tab>
<Tab title="Flutter">

```dart
final raven = Raven(token: credentials.token, endpoint: credentials.endpoint);
final room = await raven.join(credentials.roomId);
```

</Tab>
</Tabs>

Pass the room **id** or its **name** — the token carries both and either
matches. Pass anything else and you get `ROOM_NOT_FOUND` immediately,
client-side, before a connection is attempted.

## Publish media

<Tabs>
<Tab title="Web">

```ts
await room.enableCamera();
await room.enableMicrophone();
```

</Tab>
<Tab title="React">

```tsx
const camera = useCamera();
const mic = useMicrophone();

<button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
  {camera.enabled ? 'Stop camera' : 'Start camera'}
</button>
```

</Tab>
<Tab title="Flutter">

```dart
await room.enableCamera();
await room.enableMicrophone();
```

</Tab>
</Tabs>

Both return the `LocalTrack` they published, or `undefined` if the track was
already on. Neither throws when the token lacks `publish` — the server
refuses the publish and you get an `error` event, so check permissions when
you mint rather than when you publish.

## Listen for participants

<Tabs>
<Tab title="Web">

```ts
room.on('participantJoined', (participant) => {
  console.log(`${participant.identity} joined`);
});

room.on('trackSubscribed', (track, participant) => {
  const el = track.attach();
  document.getElementById(participant.identity)?.append(el);
});

room.on('participantLeft', (participant) => {
  document.getElementById(participant.identity)?.replaceChildren();
});
```

`trackSubscribed` is the one that matters for rendering: it fires when a
remote track is actually available to play, which is later than
`trackPublished`.

</Tab>
<Tab title="React">

```tsx
import { ParticipantView, useRemoteParticipants } from '@corvidhq/react';

function Grid() {
  const remote = useRemoteParticipants();
  return (
    <div>
      {remote.map((p) => (
        <ParticipantView key={p.identity} participant={p} />
      ))}
    </div>
  );
}
```

The hooks re-render on the same events, so you rarely subscribe by hand.

</Tab>
<Tab title="Flutter">

```dart
room.participantChanges.listen((participants) {
  for (final p in participants) {
    debugPrint('${p.identity} is here');
  }
});
```

Dart exposes streams rather than an event emitter — the same events, the
idiom each platform expects.

</Tab>
</Tabs>

All 17 room events are listed in [Events](/rtc/events).

## Leave

```ts
await room.leave();
```

Stops local tracks, closes the connection, and tells the room. Call it on
unmount or page-hide; a dropped socket is eventually cleaned up server-side,
but an explicit leave means everyone else sees `participantLeft` at once.

## Next steps

- [Rooms & participants](/rtc/rooms-and-participants) — device selection, data messages, the track model.
- [Events](/rtc/events) — every event, with payloads.
- [Build a video call](/guides/build-a-video-call) — the same path as a complete app.
