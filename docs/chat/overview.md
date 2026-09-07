# Raven Chat — Overview

Raven Chat is a managed real-time messaging service. You get durable messages,
presence, typing indicators, read receipts, reactions, threads, and webhooks
through one SDK call — and you never run a WebSocket server, a Redis cluster,
or a message fan-out layer yourself.

It is deliberately **not** "a WebSocket server with an SDK in front of it".
The WebSocket is an implementation detail; the guarantees are the product:

- A message is only reported as sent once it is **durably in Postgres**.
- A retried send **never creates a duplicate**.
- A client that was offline **gets what it missed** from history.
- The WebSocket is **never the source of truth**.

## Chat and RTC are separate

Raven has two planes, and they stay separate on purpose:

| | RTC | Chat |
| --- | --- | --- |
| What it carries | audio, video, screen share | messages |
| SDK | `@corvidhq/rtc` | `@corvidhq/chat` |
| Transport | WebRTC via Raven's SFU | WebSocket |
| Credential | RTC token | chat token |
| Storage | none — media is live or gone | Postgres |

They can be used together (a video call with a chat panel — see
[examples/rtc-chat](../../examples/rtc-chat)) or entirely independently.
Neither token works on the other plane, and neither service failing takes the
other down. The only link is `Conversation.roomId`, which lets one identifier
address both.

## The shape of an integration

```
Your backend  ──(project API key)──►  Raven Control API
                                              │
                                              │  short-lived chat token
                                              ▼
                                      Your frontend
                                              │
                                              │  wss://
                                              ▼
                                      Raven Chat gateway
```

Three steps, and the first two are yours:

**1. Create a conversation** (once, from your backend):

```js
import { Raven } from '@corvidhq/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const conversation = await raven.chat.createConversation({
  name: 'support-room-42',
  members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
});
```

**2. Mint a token** (per user, from your backend, after *you* have
authenticated them):

```js
const token = await raven.chat.createToken({
  userId: 'alice',
  conversations: [conversation.publicId],
  expiresIn: 3600,
});
```

**3. Connect** (in the browser):

```js
import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({ token: token.token, apiUrl: token.apiUrl });
await chat.connect({ room: conversation.publicId });

chat.on('message', (message) => console.log(message.text));
await chat.sendMessage({ text: 'Hello everyone!' });
```

That's the whole integration. No `new WebSocket(...)`, no reconnect loop, no
heartbeat, no message ordering, no dedupe logic.

## Authorization

Two independent checks, both server-side:

**The token** says who you are and what you may do. It carries a project, a
user identity, an expiry, an optional list of conversations, and a set of
scopes. It is signed with a key that is not the dashboard session key and not
the RTC token key — a leak on one plane doesn't compromise another.

**Membership** says which conversations you belong to. A `ChatMember` row with
a role (`MEMBER`, `MODERATOR`, `ADMIN`) exists per conversation, and the role
determines the scopes. A token can *narrow* what the role allows but never
widen it: asking for `chat:moderate` as a `MEMBER` gets you nothing.

| Scope | Grants |
| --- | --- |
| `chat:read` | read messages, history, presence, read receipts |
| `chat:send` | send, edit and delete your own messages, react, type |
| `chat:moderate` | delete anyone's message |
| `chat:manage` | reconfigure the conversation |

Two things the server never trusts from a browser: the sender identity (it
comes from the signed token, always) and the message type (`system` and
`event` messages require a project API key).

## Conversation references

Every place that takes a `room` accepts any of:

- the public id — `conv_9WcQ4kRz1nB2xYtL`
- the conversation name — `support-room-42`
- the id of an attached RTC room — `8d86361a-…`

So `chat.connect({ room })` works whether you carry Raven's id around or your
own name for the thing.

## Message types

`text`, `system`, `event`, `attachment`. The model is open-ended — a new type
is additive and doesn't break existing clients, because the SDK ignores frame
and message types it doesn't recognise rather than throwing.

`system` and `event` are server-only. That restriction exists so a user can't
render themselves a convincing "You have been promoted to admin" banner in
someone else's chat.

## Retention

Messages are kept indefinitely by default (`CHAT_RETENTION_DAYS=0`). Set a
deployment-wide window, or a per-conversation `retentionDays`, and a
background sweeper removes anything older:

```js
await raven.chat.createConversation({ name: 'ephemeral', retentionDays: 7 });
```

The sweeper runs on an interval with a Redis lock, so it's safe on every
instance in a fleet. Reactions, read-state links, and attachment rows follow
their message via the schema's cascade rules — nothing is orphaned.

Deleting a *message* (`chat.messages.delete()`) is a different thing: that's a
soft delete, which keeps the row so clients can render a placeholder in the
right position and moderation keeps an audit trail.

## Limits

Every limit is configurable per deployment. Defaults:

| Limit | Default | Env var |
| --- | --- | --- |
| Message text | 4 000 characters | `CHAT_MAX_TEXT_LENGTH` |
| Metadata | 4 KB | `CHAT_MAX_METADATA_BYTES` |
| WebSocket frame | 64 KB | `CHAT_MAX_FRAME_BYTES` |
| Reactions per message | 200 | `CHAT_MAX_REACTIONS_PER_MESSAGE` |
| Rooms per connection | 20 | `CHAT_MAX_ROOM_SUBSCRIPTIONS` |
| History page | 100 | `CHAT_MAX_HISTORY_PAGE_SIZE` |
| Sends | 30 / 10s / user | `CHAT_SEND_RATE_LIMIT` |
| Reactions | 60 / 10s / user | `CHAT_REACTION_RATE_LIMIT` |
| Typing signals | 20 / 10s / user | `CHAT_TYPING_RATE_LIMIT` |
| Room subscriptions | 60 / 60s / user | `CHAT_SUBSCRIBE_RATE_LIMIT` |
| Connections | 30 / 60s / IP | `CHAT_CONNECTION_RATE_LIMIT` |
| Attachment size | 25 MB | `STORAGE_MAX_ATTACHMENT_BYTES` |

Text length counts **code points, not UTF-16 units** — a 2 000-emoji message
is 2 000 characters, not 4 000.

Exceeding a limit returns a structured error, never a silent truncation:

```json
{ "code": "RATE_LIMITED", "message": "Sending messages is limited to 30 per 10s — slow down", "retryAfterSeconds": 7 }
```

## Where to go next

| Document | Covers |
| --- | --- |
| [architecture.md](architecture.md) | Services, Postgres, Redis, scaling, measured limits |
| [websocket.md](websocket.md) | The wire protocol and authentication |
| [messages.md](messages.md) | Sending, history, editing, deleting, idempotency |
| [presence.md](presence.md) | Presence |
| [typing.md](typing.md) | Typing indicators |
| [read-receipts.md](read-receipts.md) | Delivery semantics and read state |
| [reactions.md](reactions.md) | Reactions |
| [threads.md](threads.md) | Replies and threads |
| [attachments.md](attachments.md) | Signed uploads and downloads |
| [webhooks.md](webhooks.md) | Events, signatures, retries |
| [../sdk/chat.md](../sdk/chat.md) | The full `@corvidhq/chat` API reference |
