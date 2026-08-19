---
title: Messages
description: Sending, idempotency, receiving, editing, and deleting.
---

## Sending

```ts
const message = await chat.sendMessage({ text: 'Hello everyone!' });
// { id: 'msg_3xR…', roomId: 'conv_…', senderId: 'alice',
//   text: 'Hello everyone!', createdAt: '2026-08-18T12:00:00.000Z', ... }
```

The promise resolves **after the message is durably in Postgres**. The
`id` and `createdAt` are the server's, not client guesses — which is
what keeps ordering consistent across every client in the room.

| Option | Purpose |
|---|---|
| `text` | The body. Required for text messages |
| `type` | `text` (default), `attachment`. `system`/`event` are server-only |
| `replyTo` | A `msg_...` id — the reply joins that message's thread, see [Threads](/chat/threads) |
| `clientMessageId` | Idempotency key — see below |
| `attachmentId` | An `att_...` id from an already-completed upload |
| `metadata` | Your own JSON, capped at 4 KB |
| `room` | Which room, if not the one you connected to |

### The sender is never yours to choose

A browser chat token can't set `senderId`. Passing one isn't an error —
it's silently ignored, and the message is attributed to the token's
subject. Server-side, with a project API key, `senderId` is required and
honored — that's how a backend posts on a user's behalf, and it's why an
API key must never reach a browser.

## Idempotency

Networks retry. Reconnects replay. Users double-click. Any of those can
turn one intended message into two.

```ts
await chat.sendMessage({ text: 'Hello', clientMessageId: 'client_123' });
await chat.sendMessage({ text: 'Hello', clientMessageId: 'client_123' });
// Same message. The second call returns the original, with deduplicated: true.
```

`@raven/chat` attaches one automatically if you don't, so the SDK's own
retries are already safe. Supply your own when *you* control the retry
— a job queue, a form resubmit, an offline outbox.

The guarantee is a unique constraint on `(conversationId, senderId,
clientMessageId)` in Postgres, not a cache — a retry an hour later, or
on a different gateway, still deduplicates.

## Receiving

```ts
const unsubscribe = chat.on('message', (message) => {
  console.log(`${message.senderId}: ${message.text}`);
});

unsubscribe(); // call this in your cleanup
```

`on()` returns an unsubscribe function — chat handlers are overwhelmingly
registered inside component effects where cleanup is the common case,
and a mismatched `off(event, handler)` is the classic way to leak one.
`off()` still exists if you prefer it.

**You receive your own messages too**, deliberately: the sender renders
the same canonical, server-ordered row as everyone else, instead of a
local optimistic copy that has to be reconciled when the real one
arrives.

Events: `message`, `messageUpdated`, `messageDeleted`, `reactionAdded`,
`reactionRemoved`, `typing`, `presence`, `read`,
`connectionStateChanged`, `connected`, `disconnected`, `reconnecting`,
`reconnected`, `error`.

## Editing and deleting

```ts
await chat.messages.update('msg_3xR…', { text: 'Updated message' });
// { ..., text: 'Updated message', edited: true, editedAt: '...' }

await chat.messages.delete('msg_3xR…');
```

Editing always sets `editedAt` and flips `edited` to `true` — history is
never silently rewritten. Only the author may edit; moderators can
delete, not put words in someone's mouth. Deleting is soft: the row
survives with `deletedAt` set.

## Next

- [Message History](/chat/message-history) — pagination and filters.
- [Threads](/chat/threads)
- [Delivery & Read Receipts](/chat/read-receipts) — what "delivered"
  actually means, and why it isn't stored per-recipient.
