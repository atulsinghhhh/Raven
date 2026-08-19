---
title: Threads
description: Flat, not nested — a reply to a reply joins the same thread as its parent.
---

```ts
await chat.sendMessage({ text: 'This is a reply', replyTo: 'msg_3xR…' });

const thread = await chat.messages.thread('msg_3xR…'); // [root, reply, reply, ...] oldest first
```

A thread isn't a separate store — it's a filter over the same messages
table everything else lives in, so search, retention, moderation, and
webhooks all work on threaded messages automatically.

## Threads stay flat

A reply to a reply joins the same thread rather than nesting:

```
msg_A                    threadRootId: null
├── msg_B  replyTo: A    threadRootId: A
└── msg_C  replyTo: B    threadRootId: A     ← not B
```

Two reasons: it makes "give me the thread" a single indexed range scan
instead of a recursive walk, and arbitrarily deep nesting produces
conversations nobody can follow. `chat.messages.thread()` works from any
message in the thread, not just the root.

## Filtering history by thread

[Message History](/chat/message-history)'s `threadRootId` filter returns
every reply in a thread the same way — `chat.messages.thread()` is a
convenience wrapper over exactly that filter, not a separate mechanism.

## Next

- [Message History](/chat/message-history)
- [Messages](/chat/messages)
