---
title: Stream Events
description: The seven live-stream webhooks, their payloads, and the client events that are not webhooks.
---

Live streaming emits seven webhook event types. They are the only Raven
webhooks that are not chat events.

## The seven

| Event | Fires when |
|---|---|
| `live_stream.created` | A stream is created, before it is live |
| `live_stream.started` | `start()` moved it `CREATED → LIVE` |
| `live_stream.ended` | `end()` moved it `LIVE → ENDED` — terminal |
| `live_stream.host_joined` | A host or co-host was registered and credentials minted |
| `live_stream.host_left` | A co-host was removed |
| `live_stream.viewer_joined` | A viewer token was minted |
| `live_stream.viewer_left` | Your backend called `leave()` for a viewer |

Subscribe to specific types, or leave the list empty to receive all of
them:

```bash
curl -X POST "$RAVEN_API_URL/v1/projects/$PROJECT_ID/webhooks" \
  -H "Authorization: Bearer $RAVEN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "url": "https://api.example.com/hooks/raven",
        "environment": "PRODUCTION",
        "events": ["live_stream.started", "live_stream.ended"]
      }'
```

## Payloads

Each arrives in the standard [webhook envelope](/webhooks#the-payload), with
the stream's identity in `data`. The fields differ per event — these are the
exact keys each one carries:

| Event | `data` fields |
|---|---|
| `live_stream.created` | `streamId`, `title`, `visibility`, `hostIdentity`, `createdAt` |
| `live_stream.started` | `streamId`, `startedAt` |
| `live_stream.ended` | `streamId`, `endedAt`, `durationMs` (null if it never started) |
| `live_stream.host_joined` | `streamId`, `identity`, `role`, `at` |
| `live_stream.host_left` | `streamId`, `identity`, `at` |
| `live_stream.viewer_joined` | `streamId`, `identity`, `at` |
| `live_stream.viewer_left` | `streamId`, `identity`, `at` |

Note that `title` is on `created` only. If you need it on the others, keep
it from `created` or read it back with `liveStreams.get()`.

```json
{
  "id": "evt_GSyoZrH7qF3tZms0QsW4Gw",
  "type": "live_stream.created",
  "projectId": "3e48ccb1-...",
  "environment": "PRODUCTION",
  "createdAt": "2026-09-08T12:00:00.000Z",
  "data": {
    "streamId": "stream_jRoD1T3EXh0PMJRGG4zYzQ",
    "title": "Friday Q&A",
    "visibility": "PUBLIC",
    "hostIdentity": "user-1",
    "createdAt": "2026-09-08T12:00:00.000Z"
  }
}
```

Treat `data` as extensible: fields may be added, so ignore ones you do not
recognise rather than failing.

## `viewer_left` depends on you

`live_stream.viewer_joined` fires when your backend mints a viewer token.
`live_stream.viewer_left` fires when your backend calls:

```ts
await raven.liveStreams.leave(stream.id, 'user-99');
```

Raven does not infer it from the media connection dropping. If you never
call `leave()`, the event never fires and your own analytics will show
viewers who joined and never left. Wire it into whatever your product
treats as "closed the page".

## What is not a webhook

Everything happening inside the stream is a **client** event, on the
underlying room and conversation:

| You want | Use |
|---|---|
| A viewer's video arrived | `stream.room.on('trackSubscribed', …)` |
| Someone joined the room | `stream.room.on('participantJoined', …)` |
| A live chat message | `stream.chat.on('message', …)` |
| A reaction | `stream.chat.on('reactionAdded', …)` |
| Connection dropped | `stream.room.on('connectionStateChanged', …)` |

`stream.room` is an ordinary `Room` and `stream.chat` an ordinary
`ChatClient`, so [RTC events](/rtc/events) and
[Chat events](/chat/events) apply unchanged. There is no stream-specific
event emitter to learn.

## Verify and dedupe

Same rules as every webhook: verify the signature, dedupe on
`Raven-Event-Id`, order by `createdAt`, respond 2xx within 5 seconds. See
[Handle webhooks](/guides/handle-webhooks).

One case worth thinking about: `live_stream.ended` is terminal, but a retry
means you may receive it twice. Make your finalisation idempotent.

## Next steps

- [Webhooks](/webhooks) · [Event catalogue](/reference/events)
- [Streams & lifecycle](/live-streaming/streams) · [Analytics](/live-streaming/analytics)
