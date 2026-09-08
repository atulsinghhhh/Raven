---
title: WebSocket Protocol
description: For writing a client where Raven doesn't ship an SDK, or for debugging what's on the wire.
---

You don't need this page to use Raven Chat — `@ravenkash/chat` speaks this
protocol so you don't have to, and the SDK is the supported interface.
This is for a client in a language Raven doesn't ship an SDK for, or for
reading what's actually on the wire in devtools.

## Endpoint

```
wss://<your-raven-host>/v1/chat/ws?token=<chat token>
```

Always `wss://` in production — plain `ws://` is local-development only,
since a token in a URL over cleartext is a credential in cleartext.
Optional query parameters `sdkVersion`/`platform` are recorded for
debugging and don't affect behavior.

## Authentication

The token goes in the query string because **the browser WebSocket API
cannot set headers on an upgrade** — there's no `Authorization` header
option; every browser WebSocket client has this constraint. That's a
real trade-off (URLs end up in proxy logs and browser history), and it's
why chat tokens are shaped the way they are:

- Short-lived (1 hour default, 6 hours maximum, no non-expiring option).
- Revocable, checked on every connect.
- Scoped to one user and optionally to specific conversations.

Never send a project API key here — it would be a permanent, project-wide
credential sitting in a URL.

### Token claims

```json
{
  "jti": "ctk_7Qd2nF...",
  "sub": "user-123",
  "pid": "<project uuid>",
  "env": "PRODUCTION",
  "cvs": ["<conversation uuid>"],
  "scopes": ["chat:read", "chat:send"],
  "iat": 1787054953,
  "exp": 1787058553,
  "aud": "raven-chat",
  "iss": "raven"
}
```

`env` is signed rather than sent, for the same reason `sub` is: a browser
holding a development token must not be able to reach production data by
editing a request field. Tokens minted before environments existed carry no
`env` claim and resolve to development at the guard.

`aud` is fixed at `raven-chat` — what stops a dashboard session JWT or an
RTC token being replayed here even if a key were somehow shared.

### Origin

Browsers always send `Origin` on an upgrade, and page JavaScript can't
forge it. Raven checks it against the configured allow-list and rejects
a mismatch with close code `4403`. A *missing* `Origin` is allowed —
non-browser clients legitimately don't send one.

## Close codes

Application close codes live in 4000–4999 (RFC 6455 §7.4.2), distinct
from the RTC signaling plane's — a close code in devtools tells you
which plane produced it.

| Code | Meaning | Reconnect? |
|---|---|---|
| `1000` | Normal closure | No — intentional |
| `4401` | Authentication failed | **No** — retrying a bad token can't help |
| `4403` | Origin not allowed | **No** |
| `4429` | Connection rate limit | Yes, after backing off |
| `4440` | Token expired | Yes, with a **fresh token** |
| `4500` | Server shutting down | Yes, after backing off — a deploy, not a fault |

`@ravenkash/chat` treats `4401` and `4403` as terminal and reports `failed`
rather than retrying forever.

## Frame format

Every frame is a JSON object with a `type`. Flat fields, no envelope
wrapping — readable in devtools without decoding anything. A frame
carrying an `id` gets a correlated `ack` or `error` back with the same
`id`, which is how request/response is built on a socket that's
otherwise a one-way event stream.

### Client → server

| Type | Fields | Notes |
|---|---|---|
| `room.join` | `room` | Authorization is checked here |
| `room.leave` | `room` | |
| `message.send` | `room`, `text`, `messageType?`, `replyTo?`, `clientMessageId?`, `attachmentId?`, `metadata?` | |
| `message.update` | `messageId`, `text` | Author only |
| `message.delete` | `messageId` | Author, or `chat:moderate` |
| `reaction.add` / `reaction.remove` | `messageId`, `emoji` | Idempotent |
| `typing.start` / `typing.stop` | `room` | |
| `read.mark` | `messageId` | Marks this and everything before it |
| `presence.set` | `status` | `online`, `away`, `offline` |
| `ping` | — | Application-level |

### Server → client

| Type | Carries |
|---|---|
| `connected` | `connectionId`, `userId`, `scopes`, `expiresAt`, `heartbeatIntervalMs` |
| `ack` | `id`, `ok`, `data` |
| `error` | `id?`, `code`, `message`, `retryAfterSeconds?` |
| `room.joined` | `room`, `name`, `presence[]`, `typing[]` |
| `room.left` | `room` |
| `message` / `message.updated` | `message` |
| `message.deleted` | `messageId`, `roomId`, `deletedAt`, `deletedBy` |
| `reaction.added` / `reaction.removed` | `messageId`, `roomId`, `userId`, `emoji`, `at` |
| `typing.started` / `typing.stopped` | `roomId`, `userId` |
| `presence` | `roomId`, `userId`, `status`, `at` |
| `read` | `roomId`, `userId`, `messageId`, `at` |
| `pong` | `id?` |

**Unknown types must be ignored, not rejected.** A newer server may send
a frame an older client doesn't know about; throwing on one would break
a client on an upgrade it didn't ask for.

## A full exchange

```
→  (upgrade with ?token=…)
←  {"type":"connected","connectionId":"ccn_8Kd…","userId":"alice",
    "scopes":["chat:read","chat:send"],"expiresAt":"2026-08-18T13:19:49Z",
    "heartbeatIntervalMs":25000}

→  {"type":"room.join","id":"j1","room":"conv_9WcQ…"}
←  {"type":"room.joined","id":"j1","room":"conv_9WcQ…","name":"support",
    "presence":[{"userId":"bob","status":"online"}],"typing":[]}

→  {"type":"message.send","id":"m1","room":"conv_9WcQ…",
    "text":"Hello everyone!","clientMessageId":"client_1"}
←  {"type":"ack","id":"m1","ok":true,"data":{
    "status":"stored","deduplicated":false,
    "message":{"id":"msg_3xR…","senderId":"alice","createdAt":"…"}}}
←  {"type":"message","message":{"id":"msg_3xR…", ...}}
```

The `ack` is the *durability* signal, correlated to the request. The
`message` frame is the *fan-out*, and the sender receives it too — so
every participant, sender included, renders the same server-ordered row
rather than a locally-guessed one.
