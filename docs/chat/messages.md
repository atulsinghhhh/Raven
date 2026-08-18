# Raven Chat — Messages

## Sending

```js
const message = await chat.sendMessage({ text: 'Hello everyone!' });
// { id: 'msg_3xR…', roomId: 'conv_…', senderId: 'alice',
//   text: 'Hello everyone!', createdAt: '2026-08-18T12:00:00.000Z', … }
```

The promise resolves **after the message is durably in Postgres**. The `id`
and `createdAt` you get back are the server's, not guesses — which is what
makes ordering consistent across every client in the room.

Options:

| Option | Purpose |
| --- | --- |
| `text` | The body. Required for text messages |
| `type` | `text` (default), `attachment`. `system`/`event` are server-only |
| `replyTo` | A `msg_…` id; the reply joins that message's thread |
| `clientMessageId` | Idempotency key — see below |
| `attachmentId` | An `att_…` id from an already-completed upload |
| `metadata` | Your own JSON, capped at 4 KB |
| `room` | Which room, if not the one you connected to |

### The sender is never yours to choose

A browser chat token can't set `senderId`. Passing one is not an error — it's
simply ignored, and the message is attributed to the token's subject:

```js
await chat.sendMessage({ text: 'hi', senderId: 'someone-else' });
// senderId in the result: your own user id
```

Server-side, with a project API key, `senderId` is required and honoured —
that's how a backend posts on a user's behalf, and it's why an API key must
never reach a browser.

## Idempotency

Networks retry. Reconnects replay. Users double-click. Any of those can turn
one intended message into two, and "sorry, it sent twice" is a bad
experience.

Pass a `clientMessageId` and Raven guarantees the send happens once:

```js
await chat.sendMessage({ text: 'Hello', clientMessageId: 'client_123' });
await chat.sendMessage({ text: 'Hello', clientMessageId: 'client_123' });
// Same message. The second call returns the original, with deduplicated: true.
```

`@raven/chat` attaches one automatically if you don't, so the SDK's own
retries are already safe. Supply your own when *you* control the retry — a
job queue, a form resubmit, an offline outbox.

The guarantee is a unique constraint on `(conversationId, senderId,
clientMessageId)` in Postgres, not a cache. A retry that arrives an hour later,
or on a different gateway, still deduplicates. Scoping to the sender means two
users can both use `"1"` as a key without colliding.

## History

```js
const page = await chat.messages.list({ room: 'conv_9WcQ…', limit: 50 });
// { data: [...], nextCursor: 'MjAyNi0…', previousCursor: '…', hasMore: true }
```

Newest first. To page back:

```js
const older = await chat.messages.list({ before: page.nextCursor });
```

To catch up on what arrived while you were away:

```js
const newer = await chat.messages.list({ after: page.previousCursor });
```

Cursors are opaque — pass back exactly what you were given. They encode a
timestamp and a **public** message id, never an internal database id.

### Why cursors and not offsets

`?offset=50000` makes Postgres walk and discard 50 000 rows before returning
anything. Keyset pagination is an index seek at any depth.

It's also *correct* in a way offsets aren't: in a live conversation, new
messages arrive between page fetches. With an offset, that shifts every
subsequent page by one and you silently see a message twice or miss one
entirely. A cursor points at a specific position in the ordering, so it stays
valid no matter what arrives.

Ordering breaks ties on the message id, because two messages genuinely can
share a millisecond and `createdAt` alone would skip or repeat one.

Other filters: `threadRootId`, `senderId`, `includeDeleted`.

## Receiving

```js
const unsubscribe = chat.on('message', (message) => {
  console.log(`${message.senderId}: ${message.text}`);
});

unsubscribe(); // detaches — call this in your cleanup
```

`on()` returns an unsubscribe function rather than the client, because chat
handlers are overwhelmingly registered inside component effects where cleanup
is the common case, and a mismatched `off(event, handler)` is the classic way
to leak one. `off()` still exists if you prefer it.

**You receive your own messages too.** That's deliberate: the sender renders
the same canonical, server-ordered row as everyone else, instead of a local
optimistic copy that has to be reconciled when the real one arrives.

Events: `message`, `messageUpdated`, `messageDeleted`, `reactionAdded`,
`reactionRemoved`, `typing`, `presence`, `read`, `connectionStateChanged`,
`connected`, `disconnected`, `reconnecting`, `reconnected`, `error`.

## Delivery semantics

Raven distinguishes three things, and only promises the first:

| State | What it means | Where it comes from |
| --- | --- | --- |
| **accepted / stored** | Durably in Postgres | The ack. Guaranteed |
| **delivered** | A recipient's live socket received the bytes | Fan-out counters, not stored |
| **read** | A person marked it read | `chat.markAsRead()`. Durable |

"Delivered" is not stored per-recipient, because a socket receiving bytes
isn't evidence a person saw them — a backgrounded tab receives everything. A
per-recipient delivered flag would look like a strong guarantee while meaning
very little. See [read-receipts.md](read-receipts.md).

## Editing

```js
await chat.messages.update('msg_3xR…', { text: 'Updated message' });
// { …, text: 'Updated message', edited: true, editedAt: '…' }
```

Every edit sets `editedAt` and flips `edited` to `true`. History is never
silently rewritten — clients can show an "(edited)" marker, and there's no way
to change a message without that being visible.

Only the author may edit. Moderators can delete, not put words in someone's
mouth.

## Deleting

```js
await chat.messages.delete('msg_3xR…');
```

Soft delete. The row survives with `deletedAt` set, and:

- the `message.deleted` event can name the message
- clients render a placeholder in the right position, so the list doesn't jump
- moderation keeps an audit trail

The body is withheld from the API response entirely — `text`, `metadata`,
`attachment` and `reactions` all come back empty on a deleted message, so a
client can't recover the content from the payload.

Deleting is idempotent. Deleting twice is not an error; it's the same outcome.

Authors delete their own. Deleting someone else's requires `chat:moderate`.

Permanent removal is retention's job — see
[overview.md](overview.md#retention).

## Errors

Every failure is a typed error:

```js
import { RavenRateLimitError, RavenMessageError } from '@raven/chat';

try {
  await chat.sendMessage({ text: veryLongText });
} catch (error) {
  if (error instanceof RavenRateLimitError) {
    await sleep(error.retryAfterSeconds * 1000);
  } else if (error instanceof RavenMessageError) {
    showValidationError(error.message);
  }
}
```

`RavenChatError` is the base class, so one `catch` covers the whole SDK. Codes
are listed in [../error-codes.md](../error-codes.md).
