# Livqeno Chat — Read receipts

```js
await chat.markAsRead('msg_3xR…');

chat.on('read', (event) => {
  console.log(`${event.userId} has read up to ${event.messageId}`);
});

const state = await chat.getReadState();
// { lastReadMessageId: 'msg_…', lastReadAt: '…', unreadCount: 3 }
```

Marking a message read marks **everything before it** read too. That matches
how people actually read a conversation, and it means a client scrolling to
the bottom makes one call rather than one per message.

## A position, not a log

Read state is one row per `(conversation, user)` holding the furthest-read
message. Not one row per read event.

The difference is not cosmetic. A user opening a channel with 500 unread
messages generates one `UPDATE` in this model and 500 `INSERT`s in the other.
Multiply by every user and every conversation and the receipts table becomes
the largest thing in the database, storing information that's fully implied by
a single pointer.

Unread counts fall out as one indexed `COUNT` — messages in this conversation,
newer than my marker, not sent by me — rather than a set difference against a
receipts table.

## The marker only moves forward

Two tabs, one scrolled to the bottom and one at the top, will race. The
marker never moves backwards, so a stale tab can't un-read what the user has
already seen.

## Delivery semantics

Livqeno is deliberately precise about three different things:

| State | Meaning | Guarantee |
| --- | --- | --- |
| **accepted / stored** | Durably in Postgres | **Guaranteed.** The ack means this |
| **delivered** | A live socket received the bytes | Reported as a fan-out count, not stored per recipient |
| **read** | A person marked it read | Durable, client-driven |

### Why "delivered" isn't a per-recipient flag

Because a socket receiving bytes is not evidence that a person saw them. A
backgrounded tab receives everything. A phone in a pocket receives everything.
Storing a per-recipient `delivered` flag would produce a checkmark in the UI
that looks like a strong guarantee and means almost nothing.

What Livqeno reports instead is honest: how many connected sockets the message
was fanned out to, as an aggregate metric. If your product needs "delivered",
build it on `read` — which requires an actual client action — rather than on
socket mechanics.

## Everyone's position

```js
const receipts = await chat.getReadReceipts();
// [{ userId: 'bob', lastReadMessageId: 'msg_…', lastReadAt: '…' }, …]
```

Capped at 500 rows. A 10 000-member channel shouldn't return 10 000 rows to
render three avatars.

Per-user unread counts are not included here — that would be one `COUNT` per
member. Ask for your own with `getReadState()`.

## React

```jsx
import { useReadReceipts, useMessages } from '@ravenkash/react';

function MessageList() {
  const { messages } = useMessages();
  const { markAsRead, readersOf } = useReadReceipts();

  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (newest) markAsRead(newest.id);
  }, [messages.length]);

  return messages.map((message) => (
    <li key={message.id}>
      {message.text}
      <ReadBy users={readersOf(message.id, messages)} />
    </li>
  ));
}
```

A real app should gate `markAsRead` on the tab being visible — marking
messages read in a background tab is exactly the kind of thing that makes read
receipts untrustworthy.
