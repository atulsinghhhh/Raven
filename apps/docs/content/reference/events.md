---
title: Event Catalogue
description: Every event Raven emits — RTC room events, chat events, and webhooks — verified against the SDK source.
---

Raven has two separate event surfaces, and they don't overlap:

- **RTC and chat client events** fire inside your app, in the SDK
  you're already holding — `room.on(...)` and `chat.on(...)`. No
  webhook involved; these exist as long as your client is connected.
- **Webhooks** are server-to-server, for reacting to activity from your
  backend rather than a browser tab. See [Webhooks](/server/webhooks)
  for the envelope, signing, and retry behavior — this page only
  catalogues *which* events exist.

## RTC — `room.on(...)`

Every RTC event, from `@raven/rtc`'s `RoomEventMap`. Identical across
`@raven/rtc`, `@raven/react` (as `useRoomEvent`), and
`@raven/react-native` — same events, same payloads.

| Event | Payload | Fires when |
|---|---|---|
| `connectionStateChanged` | `state: ConnectionState` | The room's connection state changes — see [Reconnection](/rtc/reconnection). |
| `connected` | — | The room finished joining. |
| `disconnected` | — | The room disconnected, deliberately or not. |
| `reconnecting` | — | A dropped connection is being re-established automatically. |
| `reconnected` | — | Reconnection succeeded; tracks resume without rejoining. |
| `participantJoined` | `participant: RemoteParticipant` | Someone else joins the room. |
| `participantLeft` | `participant: RemoteParticipant` | Someone else leaves the room. |
| `trackPublished` | `kind, participant` | A remote participant starts publishing a track (before you're necessarily subscribed to it). |
| `trackUnpublished` | `kind, participant` | A remote participant stops publishing a track. |
| `trackSubscribed` | `track: RemoteTrack, participant` | A remote track becomes available to render/play locally. |
| `trackUnsubscribed` | `track: RemoteTrack, participant` | A subscribed remote track is no longer available. |
| `trackMuted` | `kind, participant` | A remote participant mutes a track they already published — see [Muting vs. unpublishing](/rtc/audio-and-video#muting-vs-unpublishing). |
| `trackUnmuted` | `kind, participant` | A remote participant unmutes a track. |
| `localTrackPublished` | `track: LocalTrack` | Your own `enableCamera()`/`enableMicrophone()`/`publish()` finished publishing. |
| `localTrackUnpublished` | `track: LocalTrack` | Your own track stops publishing. |
| `dataReceived` | `payload: Uint8Array, participant?` | A data message arrives — see [Overview → Data messages](/rtc/overview). |
| `error` | `error: RTCError` | Something failed with a typed, catchable error rather than an unhandled rejection. |

```ts
room.on('participantJoined', (participant) => {
  console.log(`${participant.identity} joined`);
});

room.on('trackSubscribed', (track, participant) => {
  videoElement.srcObject = track.mediaStream;
});
```

Two things this list does *not* include, because the SDK doesn't emit
them as discrete events: live per-participant connection-quality
updates (poll [`room.getConnectionStats()`](/rtc/diagnostics) instead),
and reconnect *attempt count* (available via
[`getDiagnostics().reconnectCount`](/rtc/diagnostics), not an event).

## Chat — `chat.on(...)`

Every chat event, from `@raven/chat`'s `ChatEventMap`.

| Event | Payload | Fires when |
|---|---|---|
| `message` | `message: ChatMessage` | A message arrives — including your own, echoed back with its canonical id. See [Messages](/chat/messages). |
| `messageUpdated` | `message: ChatMessage` | A message is edited. |
| `messageDeleted` | `event: MessageDeletedEvent` | A message is soft-deleted. |
| `reactionAdded` | `event: ReactionEvent` | Someone reacts to a message — see [Reactions](/chat/reactions). |
| `reactionRemoved` | `event: ReactionEvent` | A reaction is removed. |
| `typing` | `event: TypingEvent` | A participant's typing state changes — see [Presence & Typing](/chat/presence-and-typing). |
| `presence` | `event: PresenceEvent` | A participant's online/offline state changes. |
| `read` | `event: ReadReceiptEvent` | A read-receipt position advances — see [Delivery & Read Receipts](/chat/read-receipts). |
| `connectionStateChanged` | `state: ChatConnectionState` | The chat WebSocket's connection state changes. |
| `connected` | — | `chat.connect()` finished. |
| `disconnected` | — | The chat connection dropped, deliberately or not. |
| `reconnecting` | `attempt: number` | An automatic reconnect is in progress. |
| `reconnected` | — | Reconnection succeeded. |
| `error` | `error: RavenChatError` | A typed, catchable chat error — see [Errors](/reference/errors). |

```ts
chat.on('message', (message) => console.log(`${message.senderId}: ${message.text}`));
chat.on('typing', (event) => showTypingIndicator(event.userId, event.isTyping));
```

These map directly onto the [WebSocket protocol](/chat/websocket)'s
server frames — `chat.on(...)` is the decoded, typed form of the same
events the wire protocol carries.

## Webhooks

Delivered server-to-server through the webhook pipeline — see
[Webhooks](/server/webhooks) for the envelope, signing, and retries.
The pipeline is project-scoped rather than chat-specific, so it's the
same mechanism a future RTC or billing event would publish through, not
a second one.

| Event | Payload | Fires when |
|---|---|---|
| `message.created` | `{ message }` | A chat message is stored. |
| `message.updated` | `{ message }` | A chat message is edited. |
| `message.deleted` | `{ messageId, roomId, ... }` | A chat message is soft-deleted. |
| `reaction.added` | `{ messageId, roomId, userId, emoji, at }` | A reaction is added to a message. |
| `reaction.removed` | `{ messageId, roomId, userId, emoji, at }` | A reaction is removed from a message. |
| `room.created` | `{ roomId, name, type, rtcRoomId?, rtcRoomName?, createdAt }` | A conversation is created — `roomId` here is the conversation's public id, not an RTC room. |
| `participant.joined` | `{ roomId, userId, role, at }` | A member joins a conversation. |
| `participant.left` | `{ roomId, userId, role, at }` | A member leaves a conversation. |

Subscribe to specific events, or leave the list empty to receive
everything currently emitted; a future addition to this list is
additive, and an existing subscription with an empty filter picks it up
automatically.

## What isn't emitted as a webhook

RTC room lifecycle (`room.started`/`room.ended`), track events,
connection state changes, and presence are real-time client events
only (see the tables above) — they are not currently delivered as
webhooks, because nothing server-side needs to react to them on the
timescale a webhook implies. If your integration needs one as a
server-side signal, the equivalent data is generally available by
polling the relevant REST endpoint — see [REST API](/server/rest-api)
— or, for RTC connection data specifically, via
[Diagnostics](/rtc/diagnostics).
