---
title: Raven Client
description: '@ravenkash/client — RTC and chat behind one object, plus the LiveStream facade.'
---

`@ravenkash/client` is a facade, not a third implementation. `raven.rtc` is
a genuine `RTCClient` from `@ravenkash/rtc`, and `raven.chat` a genuine
`ChatClient` from `@ravenkash/chat`. Every method, event and type documented
for those packages applies here untouched — because they *are* those
objects.

Use it when your app needs both planes and you would rather hold one thing.
Use the individual packages when you need only one.

## Install

```bash
npm install @ravenkash/client
```

## Initialize

Both halves of the config are independent. Supply whichever planes your app
actually uses:

```ts
import { Raven } from '@ravenkash/client';

const raven = new Raven({ token, endpoint });                          // calls only
const raven = new Raven({ chatToken, chatApiUrl });                    // messaging only
const raven = new Raven({ token, endpoint, chatToken, chatApiUrl });   // both
```

| Option | For | Notes |
|---|---|---|
| `token` | RTC | From your backend. Never mint one in the browser |
| `endpoint` | RTC | The `endpoint` field from the same mint response. Required with `token` |
| `iceServers` | RTC | Forward untouched; never build your own |
| `telemetry` | RTC | Defaults `true`. Best-effort, never blocks a call |
| `telemetryUrl` | RTC | From the same mint response |
| `autoReconnect` | RTC | Defaults `true` |
| `chatToken` | Chat | From `POST /v1/chat/tokens` |
| `chatApiUrl` | Chat | The `apiUrl` from the chat-token response |
| `chatUrl` | Chat | Derived from `chatApiUrl` when omitted |
| `onChatTokenExpiring` | Chat | Return a fresh token and the connection re-establishes itself |
| `logLevel` | Both | |

`chatApiUrl` falls back to `telemetryUrl`, which is the same host in a
standard deployment. In practice you need one of them whenever `chatToken`
is set — without either there is nowhere to connect, and the SDK says so at
construction rather than falling over later.

## Core usage

```ts
const room = await raven.join('room_123');
await room.enableCamera();
await room.enableMicrophone();

await raven.chat!.connect({ room: 'room_123' });
await raven.chat!.sendMessage({ text: 'Hello' });

await raven.leave();
await raven.dispose();
```

`raven.rtc` and `raven.chat` are the underlying clients. Reach for them for
anything the facade does not shortcut:

```ts
raven.rtc?.getDevices('videoinput');
raven.chat?.messages.list({ limit: 50 });
```

`raven.chat` is `undefined` when no chat credentials were supplied — hence
the `!` above. Check it rather than assuming.

## Events

There is no facade-level emitter. Subscribe on the real objects:

```ts
const room = await raven.join('room_123');

room.on('participantJoined', (p) => console.log(p.identity));
raven.chat?.on('message', (m) => console.log(m.text));
```

Note the asymmetry, which comes from the underlying packages:
`room.on()` returns the room and chains; `chat.on()` returns an
unsubscribe function. See [RTC events](/rtc/events) and
[Chat events](/chat/events).

## Live streaming

`LiveStream` is the other half of this package — a thin wrapper that
composes a room and a conversation:

```ts
import { LiveStream } from '@ravenkash/client';

const live = await LiveStream.join(credentials);   // from addHost() or createViewerToken()

if (live.isHost) {
  await live.room.enableCamera();
  await live.room.enableMicrophone();
}

live.chat?.on('message', (m) => appendChat(m));
await live.react('❤️');
await live.leave();
```

| Member | Type |
|---|---|
| `streamId` | `string` |
| `role` | `'HOST' \| 'CO_HOST' \| 'VIEWER'` |
| `isHost` | `boolean` |
| `room` | `Room` — an ordinary RTC room |
| `chat` | `ChatClient \| undefined` |
| `react(emoji)` | Attaches a reaction to the stream's root chat message |
| `leave()` | Leaves both planes |

`react()` throws when the credentials carried no `chat` field, rather than
quietly doing nothing — reactions ride Chat's `Reaction` model, so without
a chat connection there is nowhere to put one.

## Error handling

Errors come from the underlying packages, so use their guards:

```ts
import { isRTCError } from '@ravenkash/rtc';
import { isRavenChatError } from '@ravenkash/chat';

try {
  await raven.join('room_123');
} catch (error) {
  if (isRTCError(error) && error.code === 'TOKEN_EXPIRED') await refresh();
}
```

Full lists in [Errors](/reference/errors).

## Example

`examples/live-streaming-demo` is a two-browser demo built entirely on this
package's `LiveStream` API — one host tab publishing, one viewer tab
receiving real media, with live chat and reactions.

## Next steps

- [Web SDK](/sdk/web) — the individual packages underneath.
- [Build a live stream](/guides/build-a-live-stream) · [Live Streaming](/live-streaming)
