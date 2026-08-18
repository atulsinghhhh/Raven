---
title: Messages & Threads
description: Sending, idempotency, history, editing, deleting, and flat threads.
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
| `replyTo` | A `msg_...` id — the reply joins that message's thread |
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

## History

```ts
const page = await chat.messages.list({ room: 'conv_9WcQ…', limit: 50 });
// { data: [...], nextCursor: '...', previousCursor: '...', hasMore: true }

const older = await chat.messages.list({ before: page.nextCursor });
const newer = await chat.messages.list({ after: page.previousCursor });
```

Newest first. Cursors are opaque — pass back exactly what you were
given; they encode a timestamp and a **public** message id, never an
internal database id.

Offset pagination isn't merely discouraged here — there's no parameter
for it. `?offset=50000` makes the database walk and discard 50,000 rows
before returning anything, and in a live conversation an offset silently
shifts as new messages arrive between fetches, showing you a duplicate
or skipping one. A cursor points at a specific position, so it stays
valid no matter what arrives in between.

Other filters: `threadRootId`, `senderId`, `includeDeleted`.

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

## Threads

```ts
await chat.sendMessage({ text: 'This is a reply', replyTo: 'msg_3xR…' });

const thread = await chat.messages.thread('msg_3xR…'); // [root, reply, reply, ...] oldest first
```

A thread isn't a separate store — it's a filter over the same messages
table everything else lives in, so search, retention, moderation, and
webhooks all work on threaded messages automatically.

Threads stay **flat**: a reply to a reply joins the same thread rather
than nesting.

```
msg_A                    threadRootId: null
├── msg_B  replyTo: A    threadRootId: A
└── msg_C  replyTo: B    threadRootId: A     ← not B
```

Two reasons: it makes "give me the thread" a single indexed range scan
instead of a recursive walk, and arbitrarily deep nesting produces
conversations nobody can follow. `chat.messages.thread()` works from any
message in the thread, not just the root.

## Next

- [Delivery & Read Receipts](/chat/read-receipts) — what "delivered"
  actually means, and why it isn't stored per-recipient.
- [Presence & Typing](/chat/presence-and-typing)
