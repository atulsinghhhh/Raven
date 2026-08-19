---
title: Viewers
description: Subscribe-only, and with no database row of their own — a viewer is just an SFU participant.
---

Viewers don't have a membership table like hosts do — anyone with a
valid viewer token can join, and "who's watching" is answered by asking
the SFU who's currently connected, not by querying a viewers table.

<Tabs>
<Tab title="Node.js">

```ts
const credential = await raven.liveStreams.createViewerToken(streamId, 'carol');
```

</Tab>
<Tab title="Python">

```python
credential = raven.live_streams.create_viewer_token(stream_id, "carol")
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/viewer-tokens \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "carol"}'
```

</Tab>
</Tabs>

## Joining

<Tabs>
<Tab title="Web">

```ts
const stream = await LiveStream.join(credentials); // role: 'VIEWER'

// Already-live tracks arrive synchronously; new ones fire trackSubscribed.
for (const participant of stream.room.remoteParticipants) {
  for (const track of participant.tracks) {
    if (track.kind === 'camera') track.attach(videoEl);
  }
}
stream.room.on('trackSubscribed', (track, participant) => {
  if (track.kind === 'camera') track.attach(videoEl);
});
```

</Tab>
<Tab title="React">

```tsx
import { RavenLiveStream, useLiveStreamViewer, useRemoteParticipants, ParticipantView } from '@corvidhq/react';

function Viewer({ credentials }) {
  return (
    <RavenLiveStream credentials={credentials}>
      <Stage />
    </RavenLiveStream>
  );
}

function Stage() {
  const remote = useRemoteParticipants(); // the host(s), already subscribed
  return remote.map((p) => <ParticipantView key={p.identity} participant={p} />);
}
```

</Tab>
<Tab title="React Native">

```ts
import { joinLiveStream, useLiveStream, useRemoteParticipants, RavenVideoView } from '@corvidhq/react-native';

const stream = await joinLiveStream(credentials); // role: 'VIEWER'
const { room } = useLiveStream(stream);
const remote = useRemoteParticipants(room);
```

</Tab>
<Tab title="Flutter">

```dart
final stream = await RavenLiveStream.join(credentials); // role: VIEWER

stream.room.participantChanges.listen((participants) {
  // rebuild your grid
});
```

</Tab>
</Tabs>

## Leaving

<Tabs>
<Tab title="Web">

```ts
await stream.leave();
```

</Tab>
<Tab title="React Native">

```ts
await stream.leave();
```

</Tab>
<Tab title="Flutter">

```dart
await stream.leave();
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/leave \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"identity": "carol"}'
```

The REST `leave` call is a clean-leave *signal* only (fires
`live_stream.viewer_left`) — client-side `stream.leave()` above already
tears down the room and chat connection; this endpoint exists for a
backend that wants to record the leave itself.

</Tab>
</Tabs>

## What a viewer can't do

A viewer's RTC token always has `publish: false` — there's no field on
the viewer-token request that changes that, so this isn't something a
client can request its way around. See
[Authentication](/live-streaming/authentication). A viewer can still
send chat messages and reactions with `MEMBER` scope; only publishing
media is off-limits.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `PERMISSION_DENIED` on `room.enableCamera()` | Every viewer token has `publish: false`. | Expected — a viewer becomes a co-host via `addHost()`, called by your backend, not by asking client-side. |
| No disconnect detected when a viewer's app crashes | There's no LiveKit webhook receiver for streams in this phase. | Only an explicit `stream.leave()`/`leave` call fires `live_stream.viewer_left` — don't rely on it for abrupt disconnects. |

## Related

- [Live Chat](/live-streaming/live-chat)
- [Reactions](/live-streaming/reactions)
- [SDK Support Matrix](/live-streaming/sdk-support)

- [Live Chat](/live-streaming/live-chat)
- [Reactions](/live-streaming/reactions)
