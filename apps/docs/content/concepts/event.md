---
title: Event
description: Something that happened. Delivered to a connected client as a callback, or to your backend as a webhook.
---

Raven has two event surfaces, and they do not overlap.

## Client events

Fire inside your app, in the SDK you are already holding. They exist only
while your client is connected.

```ts
room.on('participantJoined', (participant) => { /* ... */ });
chat.on('message', (message) => { /* ... */ });
```

17 room events, 14 chat events. Typed, with typed payloads. Catalogued in
[RTC events](/rtc/events) and [Chat events](/chat/events).

## Webhook events

Server-to-server. Delivered to a URL you register, for reacting from your
backend rather than a browser tab.

15 event types today, covering chat messages, reactions, conversation
membership, and live-stream lifecycle. Catalogued in
[Event catalogue](/reference/events).

## Which to use

| You want to | Use |
|---|---|
| Render a new message in the UI | Client event |
| Show who just joined the call | Client event |
| Write a message to your own database | Webhook |
| Notify a user who is not connected | Webhook |
| Trigger a workflow when a stream ends | Webhook |

The rule of thumb: if a browser tab being closed should stop it happening,
it is a client event. If it must happen regardless, it is a webhook.

## They are not the same list

An event existing on one surface does not mean it exists on the other. RTC
track and connection-state changes are **client-only** — nothing
server-side needs to react on that timescale, so they are not delivered as
webhooks. Conversely `room.created`, `participant.joined` and
`participant.left` are webhook events emitted by **chat conversation**
membership, not by RTC rooms.

That naming overlap is worth knowing before you wire a handler.

## Related

- [RTC events](/rtc/events) · [Chat events](/chat/events) · [Stream events](/live-streaming/events)
- [Event catalogue](/reference/events) — all three surfaces in one table.
- [Webhook](/concepts/webhook)
