---
title: Examples
description: Real, runnable apps in the Raven repo — grouped by which product they exercise.
---

Every example below is a real, runnable app at `examples/<name>` in the
Raven repo — not a code snippet. Each has its own README with exact
setup steps.

## RTC

- **`video-call`** — a minimal two-participant call built entirely on
  `@corvidhq/rtc`'s public API.
- **`react-video-call`** — the same call built with `@corvidhq/react`:
  join a room, camera/microphone, screen sharing, device selection.
- **`mobile-rtc-chat`** — a real call on a phone (React Native).
- **`flutter-rtc-chat`** — the same, in Flutter.
- **`signaling-demo`** — a single static HTML file exercising the
  signaling layer directly, no build step.

`video-call` boils down to this — mint a client from a server-issued
token, join a room, and publish media:

```js
import { createRTCClient } from '@corvidhq/rtc';

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.endpoint,
  iceServers: resp.iceServers,
});

const room = await client.join('room-123');
await room.enableCamera();
await room.enableMicrophone();
```

See [RTC → Quickstart](/rtc/quickstart) for the token-minting side of
this and the full room/track API.

## Chat

- **`chat`** — a working chat client on `@corvidhq/chat` and
  `@corvidhq/react` — every message really is round-tripping through
  Postgres and a WebSocket.
- **`rtc-chat`** — `@corvidhq/rtc` and `@corvidhq/chat` on the same screen,
  doing separate jobs: a call with a chat panel.

Connecting and sending a message is two calls once you have a token:

```js
import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({ token: resp.token });

await chat.connect({ room: conversation.publicId });
await chat.sendMessage({ text: 'Hello everyone!' });

chat.on('message', (msg) => console.log(msg.senderId, msg.text));
```

See [Chat → Quickstart](/chat/quickstart) for conversation setup and
the full event catalogue.

## Live Streaming

- **`live-streaming-demo`** — a two-browser demo: one host tab
  publishing camera/microphone, one viewer tab receiving real media,
  plus live chat and reactions, built entirely on `@corvidhq/client`'s
  `LiveStream` API.

`LiveStream.join()` gets you both an RTC room and a chat conversation
in one call — the host side looks like this:

```js
import { LiveStream } from '@corvidhq/client';

const stream = await LiveStream.join({
  streamId,
  role: 'HOST',
  rtc: credentials.rtc,
  chat: credentials.chat,
});

await stream.room.enableCamera();
await stream.room.enableMicrophone();

// A Raven Chat conversation comes attached automatically.
await stream.chat.sendMessage({ text: "We're live!" });
```

See [Live Streaming → Quickstart](/live-streaming/quickstart) for the
viewer side and reactions.

## Effects

- **`effects-demo`** — a single-browser demo of `@corvidhq/effects`:
  one real camera track, one `EffectsPipeline`, "Original" vs
  "Processed" video side by side. No RTC room or signaling server
  needed — it exercises the same pipeline `camera.attachEffects()` uses
  internally, directly.

Build a pipeline and attach it to any published camera track:

```js
import { effects } from '@corvidhq/effects';

const pipeline = effects.createPipeline();
pipeline.add(effects.filters.brightness({ value: 0.2 }));
pipeline.add(effects.filters.saturation({ value: 1.2 }));

const camera = await room.enableCamera();
await camera.attachEffects(pipeline);
```

See [Effects → Quickstart](/effects/quickstart) for presets and the
React hook API.

## Server SDKs

- **`node-server`** — a real Express server minting RTC tokens with
  `@corvidhq/server`.
- **`python-server`** — the same, with `raven-sdk` and FastAPI.

## RTC + Chat combined

- **`media-demo`** — a minimal static page proving real WebRTC media
  through `@corvidhq/rtc`, backed by a small FastAPI server using
  `raven-sdk`.

## Next

- [RTC → Quickstart](/rtc/quickstart)
- [Chat → Quickstart](/chat/quickstart)
- [Live Streaming → Quickstart](/live-streaming/quickstart)
- [Effects → Quickstart](/effects/quickstart)
