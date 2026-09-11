# Livqeno Chat — Messages

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

Pass a `clientMessageId` and Livqeno guarantees the send happens once:

```js
await chat.sendMessage({ text: 'Hello', clientMessageId: 'client_123' });
await chat.sendMessage({ text: 'Hello', clientMessageId: 'client_123' });
// Same message. The second call returns the original, with deduplicated: true.
```

`@ravenkash/chat` attaches one automatically if you don't, so the SDK's own
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
`connected`, `disconnected`, `reconnecting`, `reconnected`, `recovered`,
`error`.

## Delivery semantics

Livqeno distinguishes three things, and only promises the first:

| State | What it means | Where it comes from |
| --- | --- | --- |
| **accepted / stored** | Durably in Postgres | The ack. Guaranteed |
| **delivered** | A recipient's live socket received the bytes | Fan-out counters, not stored |
| **read** | A person marked it read | `chat.markAsRead()`. Durable |

"Delivered" is not stored per-recipient, because a socket receiving bytes
isn't evidence a person saw them — a backgrounded tab receives everything. A
per-recipient delivered flag would look like a strong guarantee while meaning
very little. See [read-receipts.md](read-receipts.md).

## Missed messages after a reconnect

Nothing to do. `@ravenkash/chat` catches up on its own: after it reconnects
and re-joins your rooms, it fetches whatever arrived while the socket was
down and emits it through the same `message` event as live traffic, oldest
first.

```js
chat.on('message', (m) => render(m));   // live and recovered, same handler
```

You do not need to call `messages.list({ after })` yourself, and you should
not: doing it in parallel with the SDK's own catch-up is how you get the same
message twice in your UI.

### How it decides where to resume

Every message carries an opaque `cursor` — the `(createdAt, publicId)` pair
history already paginates on. The SDK remembers the newest one it delivered
**per room** and resumes from exactly there.

`createdAt` alone would not do: two messages can land in the same
millisecond, and a timestamp-only resume point either skips one or repeats it
forever. The cursor is also a *value*, not a reference to a row, so it keeps
working after the message it names is deleted or aged out by retention —
which is what makes it safe to hold across a long absence.

The resume point is client state only. The server stores no per-client
position and behaves identically whether or not anyone ever reconnects.
Postgres remains the only record of what was said.

### What you can rely on

- **Nothing is lost.** Catch-up pages forward until the server says there is
  no more, so an outage bigger than one page is not truncated.
- **Nothing arrives twice.** Recovered messages are de-duplicated by id
  against what was already delivered, including the message that arrived live
  moments before the socket dropped.
- **Order holds.** Recovered messages are delivered oldest-first, and live
  messages arriving mid-catch-up are held back so they cannot overtake older
  ones. This is the same per-sender ordering guarantee as normal operation —
  and, as always, no total order is claimed *across* senders.
- **Authorization is unchanged.** Catch-up is the ordinary authorized history
  call. A user removed from a conversation while they were away recovers
  nothing from it.
- **Rooms are independent.** Each has its own resume point, and one room
  failing to catch up does not block the others.

### Knowing when it finished

```js
chat.on('recovered', ({ recovered, gap, errors }) => {
  if (gap) reloadTheWholeConversation();       // see below
  if (errors.length) showReconnectingBanner(); // retried on the next reconnect
});
```

`recovered` fires after every reconnect, even when there was nothing to
recover, so it is safe to use as "the client is fully caught up now".

### When recovery cannot be complete

If the resume point is rejected as unusable, the SDK does **not** silently
claim success. It reports `gap: true` and stops, leaving your application to
decide — normally by reloading the conversation from the top. Replaying from
the beginning of history instead could be an unbounded read on a busy room,
which is a worse failure than an honest gap.

If a catch-up request keeps failing, the SDK retries with backoff and then
reports that room in `errors`, keeping its resume point so the **next**
reconnect tries again from the same place. It never advances past messages it
did not deliver.

### What is not replayed

Typing and presence are ephemeral and are never replayed — a typing
indicator from four minutes ago is noise, not information. Read receipts are
not replayed either; read state is durable, so read `chat.getReadState()` or
`chat.getReadReceipts()` instead. Reactions come back on the recovered
message itself, so they reflect what is true now rather than a replay of
individual reaction events.

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
import { RavenRateLimitError, RavenMessageError } from '@ravenkash/chat';

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
