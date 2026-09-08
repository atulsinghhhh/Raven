---
title: Conversation
description: A chat channel with durable history and an explicit member list.
---

A conversation is where messages live. It is chat's equivalent of a
[room](/concepts/room), and the unit a chat token is scoped to.

## Why it exists

Authorization needs somewhere to hang. "May Alice post this?" is answered by
her membership *of a conversation* and her role in it — not by anything the
client sends.

## Three types

```ts
type ChatConversationType = 'ROOM' | 'CHANNEL' | 'DIRECT';
```

- **`ROOM`** — attached to an RTC room, for a call's chat panel.
- **`CHANNEL`** — a standalone, long-lived channel.
- **`DIRECT`** — between a fixed set of people.

There is no separate "channel" primitive; `CHANNEL` is one type of
conversation. The distinction is about lifecycle and how you look one up,
not about which APIs work.

## Created server-side

Creating a conversation and managing membership need an API key. A client
cannot invent a conversation or add itself to one:

```ts
const conversation = await raven.chat.createConversation({
  type: 'CHANNEL',
  name: 'support-room-42',
  members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
});
```

## Archiving

`ACTIVE` or `ARCHIVED`. Archiving closes writes and leaves reads working —
a write to an archived conversation returns
`RAVEN_CONVERSATION_ARCHIVED`, not a generic conflict, because "unarchive
it first" is a different fix from "your request was malformed".

## Retention

Messages are kept forever by default. Set `CHAT_RETENTION_DAYS`, or a
per-conversation override, and a sweeper enforces it.

## Related

- [Member](/chat/members) · [Message](/concepts/message)
- [Conversations](/chat/conversations) — the full API.
