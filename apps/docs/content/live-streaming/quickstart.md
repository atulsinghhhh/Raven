---
title: Live Streaming Quickstart
description: Create a stream, mint host and viewer credentials, and join as host or viewer — on every supported SDK.
---

This walks through the shortest real path: create a stream from your
backend, join as host, join as viewer, chat, and end the stream.

**Prerequisites:** a Raven project and a project API key (see
[API Keys](/authentication)) — streams are created and host/viewer
credentials are minted with it, server-side, and never in a browser or app.

## 1. Create a stream

Your backend calls the Control API with your project API key — never
exposed to the browser. Creating a stream also creates its attached
chat conversation and the host's row in one call:

<Tabs>
<Tab title="Node.js">

```ts
import { Raven } from '@ravenkash/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const stream = await raven.liveStreams.create({ title: 'Launch Day', hostIdentity: 'alice' });
// { id: 'stream_jRoD1T3EXh0PMJRGG4zYzQ', status: 'CREATED',
//   conversationId: 'conv_0iojWXJCtXZUUkDR7THBmQ',
//   chatRootMessageId: 'msg_Efm2zArYJTSRUr88BV5bZg',
//   hosts: [{ identity: 'alice', role: 'HOST' }], ... }
```

</Tab>
<Tab title="Python">

```python
from raven import Raven, CreateLiveStreamParams

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])
stream = raven.live_streams.create(CreateLiveStreamParams(title="Launch Day", host_identity="alice"))
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST http://localhost:4100/v1/live-streams \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Launch Day", "hostIdentity": "alice"}'
```

</Tab>
</Tabs>

## 2. Mint the host's credentials

<Tabs>
<Tab title="Node.js">

```ts
const hostCredential = await raven.liveStreams.addHost(stream.id, { identity: 'alice' });
// { identity: 'alice', role: 'HOST', rtc: {...}, chat: {...} }
```

</Tab>
<Tab title="Python">

```python
from raven import AddHostParams

host_credential = raven.live_streams.add_host(stream["id"], AddHostParams(identity="alice"))
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST http://localhost:4100/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/hosts \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identity": "alice", "role": "HOST"}'
```

</Tab>
</Tabs>

This returns an RTC token with full publish permissions and a chat
token with `ADMIN` scope, bundled together — forward this response
unchanged to your frontend as the join credentials.

## 3. Join as host

<Tabs>
<Tab title="Web">

```ts
import { LiveStream } from '@ravenkash/client';

const stream = await LiveStream.join(credentials); // exactly what addHost() returned, reshaped as { streamId, role, rtc, chat, chatRootMessageId }

await stream.room.enableCamera();
await stream.room.enableMicrophone();
```

`stream.room` is a real `@ravenkash/rtc` `Room` and `stream.chat` is a
real `@ravenkash/chat` client — `LiveStream` composes them, it doesn't
wrap or hide them.

</Tab>
<Tab title="React">

```tsx
'use client';
import { RavenLiveStream, useLiveStreamHost, useParticipants } from '@ravenkash/react';

function HostPage({ credentials }) {
  return (
    <RavenLiveStream credentials={credentials} fallback={<p>Connecting…</p>}>
      <HostControls />
    </RavenLiveStream>
  );
}

function HostControls() {
  const { camera, microphone } = useLiveStreamHost();
  const participants = useParticipants(); // every existing hook already works inside <RavenLiveStream>
  return (
    <button onClick={() => camera.enable()}>Go live ({participants.length} in room)</button>
  );
}
```

There's no `useLiveStreamParticipants()` — `useParticipants()` already
works, since a stream's room is an ordinary `Room`.

</Tab>
<Tab title="React Native">

```ts
import { joinLiveStream } from '@ravenkash/react-native';

const stream = await joinLiveStream(credentials);
await stream.room.enableCamera();
await stream.room.enableMicrophone();
```

`joinLiveStream()` defaults `requestPermissions` to whether the role
can publish — a host is prompted automatically, a viewer isn't.

</Tab>
<Tab title="Flutter">

```dart
import 'package:raven_live/raven_live.dart';

final stream = await RavenLiveStream.join(credentials);
await stream.room.enableCamera();
await stream.room.enableMicrophone();
```

</Tab>
</Tabs>

Then flip the stream live:

<Tabs>
<Tab title="Node.js">

```ts
await raven.liveStreams.start(stream.id);
```

</Tab>
<Tab title="Python">

```python
raven.live_streams.start(stream["id"])
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST http://localhost:4100/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/start \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

</Tab>
</Tabs>

## 4. Mint a viewer token and join

<Tabs>
<Tab title="Node.js">

```ts
const viewerCredential = await raven.liveStreams.createViewerToken(stream.id, 'carol');
```

</Tab>
<Tab title="Python">

```python
viewer_credential = raven.live_streams.create_viewer_token(stream["id"], "carol")
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST http://localhost:4100/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/viewer-tokens \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identity": "carol"}'
```

</Tab>
</Tabs>

This is always subscribe-only — there's no field on this call that
grants publish permission, by design.

<Tabs>
<Tab title="Web">

```ts
const stream = await LiveStream.join(credentials); // role: 'VIEWER'

stream.room.on('trackSubscribed', (track, participant) => {
  if (track.kind === 'camera') track.attach(videoEl);
});
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useLiveStreamViewer, useRemoteParticipants } from '@ravenkash/react';

function ViewerControls() {
  const { react } = useLiveStreamViewer();
  const remote = useRemoteParticipants();
  return <button onClick={() => react('❤️')}>❤️ ({remote.length} watching)</button>;
}
```

</Tab>
<Tab title="React Native">

```ts
const stream = await joinLiveStream(credentials); // role: 'VIEWER'
const { room } = useLiveStream(stream);
```

</Tab>
<Tab title="Flutter">

```dart
final stream = await RavenLiveStream.join(credentials); // role: VIEWER

for (final participant in stream.room.remoteParticipants) {
  // build a RavenVideoView per participant
}
```

</Tab>
</Tabs>

## 5. Chat and react

<Tabs>
<Tab title="Web">

```ts
await stream.chat.sendMessage({ text: 'hey!' });
stream.chat.on('message', (m) => console.log(m.senderId, m.text));

await stream.react('❤️');
stream.chat.on('reactionAdded', (e) => console.log(e.userId, e.emoji));
```

</Tab>
<Tab title="React Native">

```ts
await stream.chat!.send('hey!');
await stream.react('❤️');
```

</Tab>
<Tab title="Flutter">

```dart
await stream.chat?.send('hey!');
await stream.react('❤️');
```

</Tab>
</Tabs>

## 6. End the stream

<Tabs>
<Tab title="Node.js">

```ts
await raven.liveStreams.end(stream.id);
```

</Tab>
<Tab title="Python">

```python
raven.live_streams.end(stream["id"])
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST http://localhost:4100/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/end \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

</Tab>
</Tabs>

This closes the underlying room (disconnecting any remaining
participants) and fires `live_stream.ended`. Calling `start` or `end`
again on the same stream is rejected — the lifecycle only moves
forward.

## What Raven handles vs. what you handle

**Raven handles:** the RTC room, the attached chat conversation, and
enforcing that a viewer's credential can never publish — regardless of
which SDK or endpoint mints it.

**You handle:** deciding who's allowed to host (your own
authorization), and the UI around joining/leaving/reacting.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `RAVEN_STREAM_NOT_FOUND` | `streamId` wrong, or the stream belongs to a different project/environment. | Confirm you're using the id `create()` returned, not a guess. |
| `RAVEN_STREAM_INVALID_STATE` | Calling `start()` on a non-`CREATED` stream, or `end()` on a non-`LIVE` one. | Check `stream.status` first — the lifecycle only moves forward. |
| Viewer's `room.enableCamera()` throws `PERMISSION_DENIED` | Expected — a viewer token always has `publish: false`. | There's no client-side workaround; mint a host/co-host credential instead. |

## Production notes

- Never call `raven.liveStreams`/`raven.live_streams` methods from a
  browser or app — they need your project API key.
- `addHost()`/`createViewerToken()` are the security-critical calls: the
  role a client ends up with is determined entirely by which one your
  backend calls, never by anything the client sends.
- A stream's `chatRootMessageId` is required for `stream.react()` to
  work — always forward it as part of the join credentials.

## Related

- [Streams & Lifecycle](/live-streaming/streams)
- [Hosts & Co-hosts](/live-streaming/hosts), [Viewers](/live-streaming/viewers)
- [Live Chat](/live-streaming/live-chat), [Reactions](/live-streaming/reactions)
- [SDK Support Matrix](/live-streaming/sdk-support) — what's implemented where.

## Full working example

`examples/live-streaming-demo` in the Raven repo is a complete two-tab
host/viewer demo — a FastAPI backend minting credentials and a plain
HTML/JS frontend using exactly the calls above, with no bundler.
