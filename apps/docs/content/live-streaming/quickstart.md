---
title: Live Streaming Quickstart
description: Create a stream, mint host and viewer credentials, and join from the browser with @corvidhq/client.
---

This walks through the shortest real path: create a stream from your
backend, join as host, join as viewer, chat, and end the stream.

## 1. Create a stream

Your backend calls the REST API with your project API key — never
exposed to the browser. Creating a stream also creates its attached
chat conversation and the host's row in one request:

```bash
curl -X POST https://api.raven.dev/v1/live-streams \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Launch Day", "hostIdentity": "alice"}'
```

```json
{
  "id": "stream_jRoD1T3EXh0PMJRGG4zYzQ",
  "status": "CREATED",
  "conversationId": "conv_0iojWXJCtXZUUkDR7THBmQ",
  "chatRootMessageId": "msg_Efm2zArYJTSRUr88BV5bZg",
  "hosts": [{ "identity": "alice", "role": "HOST" }]
}
```

## 2. Mint the host's credentials

```bash
curl -X POST https://api.raven.dev/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/hosts \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identity": "alice", "role": "HOST"}'
```

This returns an RTC token with full publish permissions and a chat
token with `ADMIN` scope — bundle both and send them to your frontend.

## 3. Join as host

```ts
import { LiveStream } from '@corvidhq/client';

const stream = await LiveStream.join({
  streamId: 'stream_jRoD1T3EXh0PMJRGG4zYzQ',
  role: 'HOST',
  rtc: credentials.rtc,
  chat: credentials.chat,
  chatRootMessageId: 'msg_Efm2zArYJTSRUr88BV5bZg',
});

await stream.room.enableCamera();
await stream.room.enableMicrophone();
```

`stream.room` is a real `@corvidhq/rtc` `Room` and `stream.chat` is a real
`@corvidhq/chat` client — `LiveStream` composes them, it doesn't wrap or
hide them.

Then flip the stream live:

```bash
curl -X POST https://api.raven.dev/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/start \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

## 4. Mint a viewer token and join

```bash
curl -X POST https://api.raven.dev/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/viewer-tokens \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identity": "carol"}'
```

This is always subscribe-only — there's no field on this endpoint that
grants publish permission, by design.

```ts
const stream = await LiveStream.join({
  streamId: 'stream_jRoD1T3EXh0PMJRGG4zYzQ',
  role: 'VIEWER',
  rtc: credentials.rtc,
  chat: credentials.chat,
  chatRootMessageId,
});

stream.room.on('trackSubscribed', (track, participant) => {
  if (track.kind === 'camera') track.attach(videoEl);
});
```

## 5. Chat and react

```ts
await stream.chat.sendMessage({ text: 'hey!' });
stream.chat.on('message', (m) => console.log(m.senderId, m.text));

await stream.react('❤️');
stream.chat.on('reactionAdded', (e) => console.log(e.userId, e.emoji));
```

## 6. End the stream

```bash
curl -X POST https://api.raven.dev/v1/live-streams/stream_jRoD1T3EXh0PMJRGG4zYzQ/end \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

This closes the underlying room (disconnecting any remaining
participants) and fires `live_stream.ended`. Calling `start` or `end`
again on the same stream is rejected — the lifecycle only moves
forward.

## Full working example

`examples/live-streaming-demo` in the Raven repo is a complete two-tab
host/viewer demo — a FastAPI backend minting credentials and a plain
HTML/JS frontend using exactly the calls above, with no bundler.
