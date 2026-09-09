---
title: Message
description: One durable, server-ordered entry in a conversation.
---

A message is a durable row in a [conversation](/concepts/conversation). It
survives reconnects, restarts, and the sender closing their laptop.

## Why server-ordered

Every participant, sender included, renders the row the server stored — not
a locally-guessed one. That is why `sendMessage()` resolves with the stored
message *and* the sender still receives the fan-out `message` event: the
first is the durability signal, the second is what everyone renders.

Without that, two clients with skewed clocks disagree about order.

## Types

```ts
type ChatMessageType = 'text' | 'system' | 'event' | 'attachment';
```

## Idempotency

Pass a `clientMessageId` and a retry cannot double-post:

```ts
await chat.sendMessage({
  text: 'Hello everyone',
  clientMessageId: crypto.randomUUID(),
});
```

The server dedupes on `(conversation, sender, clientMessageId)`. The
response says which happened, so your UI can tell a fresh send from a
replay rather than guessing.

## Edits and deletes

Editing rewrites the text and fires `messageUpdated`. Deleting is a **soft**
delete: the row stays, the content goes, and `messageDeleted` fires. History
stays navigable and an audit trail survives.

## Threads are flat

A reply to a reply joins the same thread as its parent. There is no nesting,
which means no unbounded-depth UI and no conversation nobody can follow.

## Limits

Text is capped at 4000 characters and metadata at 4096 bytes by default;
over either returns `RAVEN_MESSAGE_TOO_LARGE`, which is deliberately
distinct from the attachment limit because you cannot act on "too large"
without knowing which limit you crossed.

## Related

- [Messages](/chat/messages) · [Message history](/chat/message-history) · [Threads](/chat/threads)
- [Limits & quotas](/reference/limits)
