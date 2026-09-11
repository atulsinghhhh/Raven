# Livqeno Chat — Threads and replies

```js
await chat.sendMessage({ text: 'This is a reply', replyTo: 'msg_3xR…' });

const thread = await chat.messages.thread('msg_3xR…');
// [root, reply, reply, …] — oldest first
```

## One message table

Threads are not a separate store. A thread is a filter over the same
`chat_messages` table every other message lives in.

That's a deliberate constraint, and it pays for itself: search, retention,
moderation, pagination, and webhooks all work on threaded messages
automatically, because there was never a second code path to teach about
them.

Each message carries two references:

- `replyTo` — the message it directly answers
- `threadRootId` — the message that started the thread

## Threads stay flat

A reply to a reply joins the **same** thread rather than starting a nested
one:

```
msg_A                    threadRootId: null
├── msg_B  replyTo: A    threadRootId: A
└── msg_C  replyTo: B    threadRootId: A     ← not B
```

Two reasons. Practically, it makes "give me the thread" a single indexed range
scan on `(threadRootId, createdAt)` instead of a recursive walk. Product-wise,
arbitrarily deep nesting produces conversations nobody can follow — Slack,
Discord and Teams all landed on flat threads for the same reason.

You still have `replyTo` if you want to render "Bob replied to Carol" inside
the thread.

## Fetching

```js
const thread = await chat.messages.thread('msg_anything_in_the_thread');
```

Works from any message in the thread, not just the root — the client doesn't
have to know which one started it. Returns the root plus every reply,
oldest-first, deleted messages excluded.

For long threads, page through them like any other history:

```js
await chat.messages.list({ threadRootId: 'msg_A', limit: 50 });
```

## Constraints

- **Same conversation only.** Replying across conversations would produce a
  message referencing a thread the reader can't see, so it's refused.
- **No replying to deleted messages.** Returns `MESSAGE_DELETED`.
- **Deleting the root doesn't delete the thread.** Replies remain, with the
  root rendered as a tombstone. Cascading would let one deletion take out an
  arbitrary amount of other people's writing.

## Real-time

Thread replies arrive on the normal `message` event with `replyTo` and
`threadRootId` populated. There's no separate thread subscription — a client
already subscribed to the conversation gets them.

Route them in your handler:

```js
chat.on('message', (message) => {
  if (message.threadRootId) {
    appendToThread(message.threadRootId, message);
  } else {
    appendToMainView(message);
  }
});
```
