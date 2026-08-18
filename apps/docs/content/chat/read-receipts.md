---
title: Delivery & Read Receipts
description: A position, not a log — and why "delivered" isn't a per-recipient flag.
---

```ts
await chat.markAsRead('msg_3xR…');

chat.on('read', (event) => {
  console.log(`${event.userId} has read up to ${event.messageId}`);
});

const state = await chat.getReadState();
// { lastReadMessageId: 'msg_…', lastReadAt: '...', unreadCount: 3 }
```

Marking a message read marks **everything before it** read too — that
matches how people actually read a conversation, and it means a client
scrolling to the bottom makes one call, not one per message.

## A position, not a log

Read state is one row per `(conversation, user)` holding the
furthest-read message — not one row per read event.

The difference isn't cosmetic. A user opening a channel with 500 unread
messages generates one `UPDATE` in this model and 500 `INSERT`s in the
other. Multiply by every user and every conversation, and a per-event
log becomes the largest table in the database, storing information
already fully implied by a single pointer.

Unread counts fall out as one indexed count — messages in this
conversation, newer than my marker, not sent by me — rather than a set
difference against a receipts table.

## The marker only moves forward

Two tabs, one scrolled to the bottom and one at the top, will race. The
marker never moves backwards, so a stale tab can't un-read what the user
has already seen.

## Delivery semantics — three different things

| State | Meaning | Guarantee |
|---|---|---|
| **accepted / stored** | Durably in Postgres | Guaranteed — the ack means this |
| **delivered** | A live socket received the bytes | Reported as a fan-out count, not stored per recipient |
| **read** | A person marked it read | Durable, client-driven |

### Why "delivered" isn't a per-recipient flag

A socket receiving bytes isn't evidence a person saw them. A backgrounded
tab receives everything. A phone in a pocket receives everything. A
per-recipient `delivered` flag would produce a checkmark that looks like
a strong guarantee and means almost nothing.

What Raven reports instead is honest: how many connected sockets a
message was fanned out to, as an aggregate metric. If your product needs
"delivered" semantics, build them on `read` — which requires an actual
client action — rather than on socket mechanics.

## Everyone's position

```ts
const receipts = await chat.getReadReceipts();
// [{ userId: 'bob', lastReadMessageId: 'msg_…', lastReadAt: '...' }, ...]
```

Capped at 500 rows — a 10,000-member channel shouldn't return 10,000
rows to render three avatars.
