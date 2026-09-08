---
title: RTC Events
description: Every event a Room emits, with its payload and when it fires. Identical across Web, React and React Native.
---

`Room` is a typed event emitter. These 17 events are its whole surface —
from `RoomEventMap` in `@corvidhq/rtc`, and the same set on
`@corvidhq/react-native`, because it is the same class.

```ts
function onJoin(participant: RemoteParticipant) {
  console.log(`${participant.identity} joined`);
}

room.on('participantJoined', onJoin);
room.off('participantJoined', onJoin);      // keep the reference to unsubscribe
```

`room.on()` returns the room, so calls chain:

```ts
room.on('connected', render).on('participantJoined', render).on('participantLeft', render);
```

> **`@corvidhq/chat` differs here.** `chat.on()` returns an **unsubscribe
> function** rather than the client, because chat handlers are almost always
> registered inside a component effect where cleanup is the common path.
> `room.on()` chains; `chat.on()` hands you the teardown. See
> [Chat events](/chat/events).

## Connection

| Event | Payload | Fires when |
|---|---|---|
| `connectionStateChanged` | `state: ConnectionState` | The state changes. The one to drive UI from |
| `connected` | — | The room finished joining |
| `disconnected` | — | The connection ended, deliberately or not |
| `reconnecting` | — | A dropped connection is being re-established |
| `reconnected` | — | Recovery succeeded. Your tracks are already republished |

`reconnected` carries no payload because there is nothing to reattach —
that is the guarantee, not an omission. See
[Reconnection](/rtc/reconnection).

## Participants

| Event | Payload | Fires when |
|---|---|---|
| `participantJoined` | `participant: RemoteParticipant` | Someone else joins |
| `participantLeft` | `participant: RemoteParticipant` | Someone else leaves |

Only remote participants. You already know when you joined.

## Remote tracks

| Event | Payload | Fires when |
|---|---|---|
| `trackPublished` | `kind: TrackKind, participant: RemoteParticipant` | A remote participant starts publishing |
| `trackUnpublished` | `kind: TrackKind, participant: RemoteParticipant` | They stop publishing |
| `trackSubscribed` | `track: RemoteTrack, participant: RemoteParticipant` | The track is available to render |
| `trackUnsubscribed` | `track: RemoteTrack, participant: RemoteParticipant` | It is no longer available |
| `trackMuted` | `kind: TrackKind, participant: RemoteParticipant` | They muted a track they are still publishing |
| `trackUnmuted` | `kind: TrackKind, participant: RemoteParticipant` | They unmuted it |

**Render on `trackSubscribed`, not `trackPublished`.** Published means the
track exists; subscribed means media has arrived. Attaching on the first
gives you an empty element.

`trackMuted` is not `trackUnpublished`. A muted track stays published, so
keep the participant's tile and show a muted badge — tearing the tile down
and rebuilding it on unmute is the visible difference.

## Your own tracks

| Event | Payload | Fires when |
|---|---|---|
| `localTrackPublished` | `track: LocalTrack` | `enableCamera()`, `enableMicrophone()`, `enableScreenShare()` or `publish()` finished |
| `localTrackUnpublished` | `track: LocalTrack` | Your track stopped publishing |

## Data and errors

| Event | Payload | Fires when |
|---|---|---|
| `dataReceived` | `payload: Uint8Array, participant?: RemoteParticipant` | A data-channel message arrived |
| `error` | `error: RTCError` | Something failed, as a typed error rather than an unhandled rejection |

`participant` on `dataReceived` is optional because a message can arrive
without an attributable sender. Handle the undefined case.

```ts
import { isRTCError } from '@corvidhq/rtc';

room.on('error', (error) => {
  if (isRTCError(error) && error.code === 'CAMERA_PERMISSION_DENIED') {
    showPermissionHelp();
  }
});
```

## Not events

Two things you might reach for, which the SDK deliberately does not emit:

- **Per-participant connection quality.** Poll
  [`room.getConnectionStats()`](/rtc/diagnostics) instead.
- **Reconnect attempt count.** Read
  `getDiagnostics().reconnectCount`.

There is also **no active-speaker event** — see
[Known limitations](/reference/known-limitations).

## Other platforms

<Tabs>
<Tab title="React">

The hooks subscribe for you and re-render on the same events:

```tsx
const state = useConnectionState();
const participants = useParticipants();
const remote = useRemoteParticipants();
const local = useLocalParticipant();
const error = useRavenError();
```

`useRaven()` exposes the underlying `Room` if you need `on()` directly.

</Tab>
<Tab title="Flutter">

Dart exposes streams rather than an emitter — the same events, in the idiom
the platform expects:

```dart
room.connectionStateChanges.listen((state) { });
room.participantChanges.listen((participants) { });
room.data.listen((bytes) { });
room.errors.listen((error) { });
```

`RavenRoom` is also a `ChangeNotifier`, so it works directly with
`ListenableBuilder`.

</Tab>
</Tabs>

## Next steps

- [Chat events](/chat/events) · [Stream events](/live-streaming/events)
- [Event catalogue](/reference/events) — all surfaces, including webhooks.
- [Signaling protocol](/rtc/signaling-protocol) — the frames underneath these.
