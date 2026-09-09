---
title: Event catalogue
description: Every event Raven emits, across all three surfaces, in one table. Generated claims verified against source.
---

Raven emits events on three surfaces. They are not the same list, and an
event existing on one does not mean it exists on another.

| Surface | Delivered to | Count | Reference |
|---|---|---|---|
| RTC client events | Your app, via `room.on(...)` | 17 | [RTC events](/rtc/events) |
| Chat client events | Your app, via `chat.on(...)` | 14 | [Chat events](/chat/events) |
| Webhooks | Your backend, over HTTP | 15 | Below, and [Webhooks](/webhooks) |

The rule of thumb for which to use: if a browser tab closing should stop it
happening, it is a client event. If it must happen regardless, it is a
webhook.

## Webhook events

All 15 types, each verified to have a real emit site in the API.

### Chat

| Event | Payload | Fires when |
|---|---|---|
| `message.created` | `{ message }` | A message is stored |
| `message.updated` | `{ message }` | A message is edited |
| `message.deleted` | `{ messageId, roomId, ... }` | A message is soft-deleted |
| `reaction.added` | `{ messageId, roomId, userId, emoji, at }` | A reaction is added |
| `reaction.removed` | `{ messageId, roomId, userId, emoji, at }` | A reaction is removed |

### Conversation membership

These three have RTC-sounding names and are **emitted by chat**. Worth
knowing before you wire a handler.

| Event | Payload | Fires when |
|---|---|---|
| `room.created` | `{ roomId, name, type, rtcRoomId?, rtcRoomName?, createdAt }` | A **conversation** is created. `roomId` is the conversation's public id, not an RTC room |
| `participant.joined` | `{ roomId, userId, role, at }` | A member joins a **conversation** |
| `participant.left` | `{ roomId, userId, role, at }` | A member leaves a **conversation** |

### Live streaming

| Event | Fires when |
|---|---|
| `live_stream.created` | A stream is created |
| `live_stream.started` | `CREATED → LIVE` |
| `live_stream.ended` | `LIVE → ENDED`, terminal |
| `live_stream.host_joined` | A host or co-host was registered |
| `live_stream.host_left` | A co-host was removed |
| `live_stream.viewer_joined` | A viewer token was minted |
| `live_stream.viewer_left` | Your backend called `leave()` for a viewer |

Payloads and the `viewer_left` caveat are in
[Stream events](/live-streaming/events).

## What is not a webhook

RTC room lifecycle, track events, connection-state changes, and presence
are **client events only**. Nothing server-side needs to react on the
timescale a webhook implies, and delivering them would mean a webhook per
ICE state change.

If your integration needs one of them as a server-side signal, the
equivalent data is available by polling — see
[Observability API](/api/observability) for connection history, or
[REST API](/api) for the rest.

There is also **no active-speaker event** on any surface. See
[Known limitations](/reference/known-limitations).

## Subscribing

```bash
curl -X POST "$RAVEN_API_URL/v1/projects/$PROJECT_ID/webhooks" \
  -H "Authorization: Bearer $RAVEN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "url": "https://api.example.com/hooks", "environment": "PRODUCTION" }'
```

Omit `events` to receive everything, including types added later — an
addition to the list above is additive, and an empty filter picks it up
automatically.

## Next steps

- [RTC events](/rtc/events) · [Chat events](/chat/events) · [Stream events](/live-streaming/events)
- [Webhooks](/webhooks) — envelope, signing, retries.
- [Handle webhooks](/guides/handle-webhooks) — a working receiver.
