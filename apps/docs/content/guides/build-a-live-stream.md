---
title: Build a live stream
description: One host publishing to many subscribe-only viewers, with a real chat conversation attached.
---

## What we're building

A stream page: a host publishing camera and microphone, viewers watching,
live chat, and emoji reactions. Two different clients, two different
credentials, one stream.

## Prerequisites

- A project and an API key.
- `npm install @corvidhq/client` — the `LiveStream` facade lives there.

## Implementation

### 1. Create the stream

```ts
const stream = await raven.liveStreams.create({
  title: 'Friday Q&A',
  hostIdentity: 'user-1',      // required: a stream is created with its host
  visibility: 'PUBLIC',
});
```

This provisions an RTC room *and* a chat conversation. You do not create
either yourself.

### 2. Mint credentials — different endpoint per role

```ts
// The host, or an additional co-host.
const hostCredentials = await raven.liveStreams.addHost(stream.id, { identity: 'user-1' });

// A viewer.
const viewerCredentials = await raven.liveStreams.createViewerToken(stream.id, 'user-99');
```

Both return the same shape — `{ streamId, role, rtc, chat, chatRootMessageId }` —
already arranged for `LiveStream.join()`. Forward it untouched.

The difference is what is *signed into* the RTC token. A viewer's has
`publish: false`. There is no request a viewer client can make that changes
that.

### 3. Go live

```ts
await raven.liveStreams.start(stream.id);   // CREATED → LIVE
```

### 4. Join, as either role

<Tabs>
<Tab title="Web">

```ts
import { LiveStream } from '@corvidhq/client';

const live = await LiveStream.join(credentials);

if (live.isHost) {
  await live.room.enableCamera();
  await live.room.enableMicrophone();
}

live.room.on('trackSubscribed', (track) => {
  stage.append(track.attach());
});

live.chat?.on('message', (m) => appendChat(m));
await live.react('❤️');
```

`live.room` is an ordinary `Room` and `live.chat` an ordinary `ChatClient` —
every API on those works here.

</Tab>
<Tab title="React">

```tsx
'use client';
import { RavenLiveStream, useLiveStreamRole, useCamera } from '@corvidhq/react';

function StreamPage({ credentials }) {
  return (
    <RavenLiveStream credentials={credentials}>
      <Stage />
    </RavenLiveStream>
  );
}

function Stage() {
  const role = useLiveStreamRole();
  const camera = useCamera();
  return role === 'VIEWER' ? <ViewerGrid /> : <button onClick={() => camera.enable()}>Go live</button>;
}
```

</Tab>
<Tab title="Flutter">

```dart
final stream = await RavenLiveStream.join(credentials);

if (stream.isHost) {
  await stream.room.enableCamera();
  await stream.room.enableMicrophone();
}

stream.chat?.messages.listen((m) => setState(() => _chat.add(m)));
await stream.react('❤️');
```

</Tab>
</Tabs>

### 5. Track viewers and end

```ts
const live = await raven.liveStreams.get(stream.id);
console.log(live.viewerCount, live.peakViewerCount);

await raven.liveStreams.end(stream.id);   // LIVE → ENDED, terminal
```

When a viewer leaves, tell the API so the count and the
`live_stream.viewer_left` webhook are right:

```ts
await raven.liveStreams.leave(stream.id, 'user-99');
```

## How it works

**A stream is composition, not a third media stack.** Create provisions a
room and a conversation; the credential endpoints mint an RTC token and a
chat token together. That is why `LiveStream.room` is a real `Room`: there
is no parallel implementation to keep in step.

**Roles are permission shapes.** `HOST`, `CO_HOST` and `VIEWER` differ only
in what their tokens grant. Which one you get is decided entirely by which
endpoint your backend called — never by anything the client sends.

**Reactions ride Chat's `Reaction` model.** Every stream gets a root chat
message on creation, and `react()` attaches a reaction to it. That is why
`react()` throws when the stream has no chat credentials, and why
`chatRootMessageId` is part of the credentials.

**Status only moves forward.** `CREATED → LIVE → ENDED`. Anything invalid
from the current status returns `RAVEN_STREAM_INVALID_STATE` rather than a
generic conflict, because "you already ended this" needs a different fix
from "your body was malformed".

## Production considerations

- **Viewer credentials must be minted per viewer.** They carry an identity,
  and reusing one across people breaks the participant roster and the
  counts.
- **The viewer count is a live SFU reading minus registered hosts.** It is
  not a stored analytics series — there is no historical viewer curve. See
  [Analytics](/live-streaming/analytics).
- **No recording exists.** If your product needs a replay, you need to
  build it outside Raven.
- **Scale is unproven for large audiences.** Raven's own tests reach 100
  participants on loopback with synthetic media. A 10,000-viewer broadcast
  is a different problem and is not something Raven has measured.
- **End your streams.** An abandoned `LIVE` stream keeps a room allocated.
  Wire `end()` into whatever your product treats as "the host left".

## Next steps

- [Live Streaming](/live-streaming) · [Streams & lifecycle](/live-streaming/streams)
- [Stream events](/live-streaming/events) — the seven webhooks.
- [SDK support matrix](/live-streaming/sdk-support) — what each SDK implements.
