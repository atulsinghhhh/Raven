---
title: Chat Overview
description: Durable messages, presence, and receipts — a managed service, not a WebSocket you have to operate.
---

Livqeno Chat gives you durable messages, presence, typing indicators, read
receipts, reactions, and threads through one SDK — you never run a
WebSocket server, a Redis cluster, or a fan-out layer yourself.

It's deliberately not "a WebSocket server with an SDK in front of it."
The WebSocket is an implementation detail; the guarantees are the
product:

- A message is only reported as sent once it's **durably in Postgres**.
- A retried send **never creates a duplicate**.
- A client that was offline **gets what it missed** from history.
- The WebSocket is **never the source of truth**.

## Chat and RTC are separate

| | RTC | Chat |
|---|---|---|
| Carries | audio, video, screen share | messages |
| SDK | `@ravenkash/rtc` | `@ravenkash/chat` |
| Transport | WebRTC | WebSocket |
| Credential | RTC token | chat token |
| Storage | none — media is live or gone | PostgreSQL |

They can be used together — a video call with a chat panel — or entirely
independently. Neither token works on the other plane, and neither
service failing takes the other down. The only link is
`Conversation.roomId`, letting one identifier address both.

## The shape of an integration

```
Your backend  ──(project API key)──►  Livqeno control plane
                                              │  short-lived chat token
                                              ▼
                                       Your frontend
                                              │  wss://
                                              ▼
                                   Livqeno Chat gateway
```

**1. Create a conversation** (once, from your backend):

```ts
import { Raven } from '@ravenkash/server';
const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY,
  baseUrl: process.env.RAVEN_API_URL, // https://api.ravenstack.online
});

const conversation = await raven.chat.createConversation({
  name: 'support-room-42',
  members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
});
```

**2. Mint a token** (per user, after *you* have authenticated them):

```ts
const token = await raven.chat.createToken({
  userId: 'alice',
  conversations: [conversation.publicId],
  expiresIn: 3600,
});
```

**3. Connect** (in the browser):

```ts
import { createChatClient } from '@ravenkash/chat';

const chat = createChatClient({ token: token.token, apiUrl: token.apiUrl });
await chat.connect({ room: conversation.publicId });

chat.on('message', (message) => console.log(message.text));
await chat.sendMessage({ text: 'Hello everyone!' });
```

No `new WebSocket(...)`, no reconnect loop, no heartbeat, no ordering or
dedupe logic.

## Authorization — two independent checks

**The token** says who you are and what you may do: a project, a user
identity, an expiry, an optional list of conversations, and a set of
scopes — signed with a key that is neither the dashboard session key nor
the RTC key, so a leak on one plane doesn't compromise another.

**Membership** says which conversations you belong to. A role
(`MEMBER`, `MODERATOR`, `ADMIN`) per conversation determines the scopes
available. A token can *narrow* what the role allows but never widen it.

| Scope | Grants |
|---|---|
| `chat:read` | read messages, history, presence, read receipts |
| `chat:send` | send/edit/delete your own messages, react, type |
| `chat:moderate` | delete anyone's message |
| `chat:manage` | reconfigure the conversation |

Two things the server never trusts from a browser: the sender identity
(always from the signed token) and the message type — `system` and
`event` messages require a project API key, so a user can't fabricate an
official-looking announcement.

## Conversation references

Anywhere that takes a `room`, you can pass any of:

- the public id — `conv_9WcQ4kRz1nB2xYtL`
- the conversation name — `support-room-42`
- the id of an attached RTC room

So `chat.connect({ room })` works whether you track Livqeno's id or your
own name for the thing.

## Next

- [Quickstart](/chat/quickstart)
- [Conversations](/chat/conversations)
- [Members](/chat/members)
- [Messages](/chat/messages)
- [Presence](/chat/presence)
- [Typing Indicators](/chat/typing)
- [WebSocket Protocol](/chat/websocket) — for a from-scratch client.

Need audio/video alongside the conversation? See [Livqeno RTC](/rtc).
Building a live community rather than a support thread? See
[Livqeno Live Streaming](/live-streaming) — every stream gets a Livqeno
Chat conversation attached automatically.
