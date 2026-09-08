---
title: Live stream
description: A room and a conversation, with host and viewer roles. Built on RTC and Chat, not beside them.
---

A live stream is one host (plus optional co-hosts) publishing to any number
of subscribe-only viewers, with a chat conversation attached.

## Why it exists

Broadcasting is a call with asymmetric permissions and a bigger audience.
Rather than a second media stack, a stream is composition: creating one
provisions an RTC [room](/concepts/room) and a chat
[conversation](/concepts/conversation), and minting a credential returns
tokens for both.

`LiveStream.room` really is a `Room`, and `LiveStream.chat` really is a
`ChatClient`. Every API documented for those works on a stream.

## Roles

| Role | Publishes | Set by |
|---|---|---|
| `HOST` | Yes | Whoever created the stream |
| `CO_HOST` | Yes | `POST /v1/live-streams/{id}/hosts` |
| `VIEWER` | No | `POST /v1/live-streams/{id}/viewer-tokens` |

A viewer's RTC token has `publish: false` **signed into it**. Viewers cannot
publish — not by policy, by construction. A viewer also has no database row
of its own; it is an SFU participant and a counter.

## Lifecycle only moves forward

```
CREATED → LIVE → ENDED
```

`ENDED` is terminal. Starting an already-live stream, or anything at all on
an ended one, returns `RAVEN_STREAM_INVALID_STATE`.

## Minimal example

```ts
const stream = await raven.liveStreams.create({
  title: 'Friday Q&A',
  hostIdentity: 'user-1',   // required — a stream is created with its host
});
const host = await raven.liveStreams.addHost(stream.id, { identity: 'user-1' });   // host credentials
const viewer = await raven.liveStreams.createViewerToken(stream.id, 'user-2');
```

```ts
import { LiveStream } from '@corvidhq/client';

const live = await LiveStream.join(hostCredentials);
await live.room.enableCamera();
await live.chat!.sendMessage({ text: "We're live" });
```

## No recording

Nothing captures a stream to storage. Stated because it changes designs.

## Related

- [Live Streaming](/live-streaming) · [Streams & lifecycle](/live-streaming/streams)
- [Room](/concepts/room) · [Conversation](/concepts/conversation)
