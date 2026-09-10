---
title: Idempotency
description: Retry a create or a mint without doing it twice. Which endpoints support it, and the two windows.
---

Network calls fail after the server did the work. Idempotency makes the
retry safe.

## HTTP: the Idempotency-Key header

```bash
curl -X POST "$RAVEN_API_URL/v1/rooms/$ROOM_ID/rtc-tokens" \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Idempotency-Key: 3f8a1c22-your-own-uuid" \
  -H 'Content-Type: application/json' \
  -d '{"participantIdentity":"user-42","permissions":{"join":true,"subscribe":true}}'
```

A retry with the same key replays the original response rather than minting
a second token.

Generate the key yourself — a UUID per logical operation. Reusing one across
genuinely different operations is the one way to get a wrong answer.

The [endpoint pages](/api/all-endpoints) mark which routes support it.

## The token-minting window is short

Most idempotent endpoints cache a replay for 24 hours. RTC token minting
caches for **5 minutes**.

That is deliberate. An RTC token can expire in as little as 30 seconds.
Replaying a cached response an hour later would hand back a dead credential
and the failure would look like a Livqeno bug rather than a stale replay. A
short window means a retry either replays a still-useful token or mints a
fresh one.

## Chat: clientMessageId

Messages use a field rather than a header, because the same guarantee has to
hold over the WebSocket, where there are no headers:

```ts
await chat.sendMessage({
  text: 'Hello everyone',
  clientMessageId: crypto.randomUUID(),
});
```

Deduplication is on `(conversation, sender, clientMessageId)`, backed by a
unique constraint in Postgres with a Redis fast path in front. The response
tells you which happened:

```ts
const result = await chat.sendMessage({ text: 'Hi', clientMessageId: id });
// result.deduplicated === true  → this was a replay, not a new message
```

So your UI can tell a fresh send from a replay instead of guessing. Over
HTTP a replayed message returns `RAVEN_MESSAGE_ALREADY_EXISTS`.

## What is not idempotent

Deletes and lifecycle transitions are not, and do not need to be. Ending an
already-ended stream returns `RAVEN_STREAM_INVALID_STATE`; deleting an
already-closed room is a no-op on a `CLOSED` row. Both are safe to retry —
they just are not *replays*.

## Related

- [Conventions](/api/conventions) · [Messages](/chat/messages)
- [Errors](/reference/errors)
