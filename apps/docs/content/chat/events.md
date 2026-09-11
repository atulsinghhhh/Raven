---
title: Chat Events
description: Every event a ChatClient emits, with its payload and when it fires.
---

`ChatClient` is a typed event emitter. These 14 events are its whole
surface — from `ChatEventMap` in `@ravenkash/chat`.

```ts
const unsubscribe = chat.on('message', (message) => {
  render(message.senderId, message.text);
});

unsubscribe();      // idempotent — calling it twice is safe
```

`chat.on()` returns an **unsubscribe function**, which is deliberately
different from `room.on()` in `@ravenkash/rtc` (that one returns the room so
calls chain). Chat handlers are usually registered inside a component
effect, where cleanup is the common path and a mismatched
`off(event, handler)` is the classic way to leak one. `chat.off()` still
exists if you prefer it.

## Messages

| Event | Payload | Fires when |
|---|---|---|
| `message` | `message: ChatMessage` | A message arrives — **including your own**, echoed with its canonical id |
| `messageUpdated` | `message: ChatMessage` | A message was edited |
| `messageDeleted` | `event: MessageDeletedEvent` | A message was soft-deleted |

You receive your own messages back on purpose. `sendMessage()` resolving is
the *durability* signal; this event is the *fan-out*. Render from the event
and every participant, sender included, shows the same server-assigned
order rather than a locally-guessed one.

## Reactions

| Event | Payload | Fires when |
|---|---|---|
| `reactionAdded` | `event: ReactionEvent` | Someone reacted |
| `reactionRemoved` | `event: ReactionEvent` | A reaction was removed |

Both are idempotent server-side, so a double-tap on a flaky connection is
harmless. See [Reactions](/chat/reactions).

## Ephemeral state

| Event | Payload | Fires when |
|---|---|---|
| `typing` | `event: TypingEvent` | Someone's typing state changed |
| `presence` | `event: PresenceEvent` | Someone's online state changed |
| `read` | `event: ReadReceiptEvent` | A read position advanced |

None of these is persisted. Presence goes offline by **TTL expiry** rather
than by an explicit message — which is why a crashed browser shows as
offline within 45 seconds instead of never.

You do **not** receive an echo of your own `read`. Use the value
`markAsRead()` returns rather than waiting for an event that will not come.

## Connection

| Event | Payload | Fires when |
|---|---|---|
| `connectionStateChanged` | `state: ChatConnectionState` | The socket's state changed |
| `connected` | — | `connect()` finished |
| `disconnected` | — | The connection dropped, deliberately or not |
| `reconnecting` | `attempt: number` | An automatic reconnect is in progress |
| `reconnected` | — | Recovery succeeded |

`reconnecting` carries the attempt number, unlike RTC's — useful for
"still trying (3)" copy.

## Errors

| Event | Payload |
|---|---|
| `error` | `error: RavenChatError` |

```ts
import { isRavenChatError } from '@ravenkash/chat';

chat.on('error', (error) => {
  if (!isRavenChatError(error)) return;
  if (error.code === 'TOKEN_EXPIRED') refreshToken();
  if (error.code === 'RATE_LIMITED') backOff(error.retryAfterSeconds);
});
```

An unrecognised code from a newer server arrives as a base
`RavenChatError` with the code preserved, so an older client keeps working
across a server upgrade.

## These map onto the wire

Each event is the decoded, typed form of a server frame. `message` is the
`message` frame, `typing` is `typing.started`/`typing.stopped` collapsed
into one event with a boolean. If you need the frame level — for a client
in a language Livqeno does not ship — see
[WebSocket protocol](/chat/websocket).

## Other platforms

<Tabs>
<Tab title="React">

```tsx
const { messages, send, loadMore, hasMore } = useMessages();
const { typingUsers, onInput } = useTyping();
const presence = usePresence();
const state = useChatConnectionState();
const error = useChatError();
```

</Tab>
<Tab title="Flutter">

```dart
chat.messages.listen((m) { });
chat.messageUpdates.listen((m) { });
chat.messageDeletions.listen((id) { });
chat.typing.listen((e) { });
chat.presence.listen((p) { });
chat.reactions.listen((e) { });
chat.readReceipts.listen((r) { });
chat.connectionStateChanges.listen((s) { });
chat.errors.listen((e) { });
```

</Tab>
</Tabs>

## Next steps

- [RTC events](/rtc/events) · [Event catalogue](/reference/events)
- [Messages](/chat/messages) · [WebSocket protocol](/chat/websocket)
