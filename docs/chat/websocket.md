# Raven Chat — WebSocket protocol

You do not need this document to use Raven Chat. `@ravenkash/chat` speaks this
protocol so you don't have to, and the SDK is the supported interface. This is
here for people writing a client in a language Raven doesn't ship an SDK for,
and for debugging what's actually on the wire.

## Endpoint

```
wss://<your-raven-host>/v1/chat/ws?token=<chat token>
```

Always `wss://` in production. Plain `ws://` is local-development only — a
chat token in a URL over cleartext is a credential in cleartext.

Optional query parameters: `sdkVersion` and `platform`, both recorded on the
connection for debugging. Neither affects behaviour.

## Authentication

The token goes in the query string because **the browser WebSocket API cannot
set headers on an upgrade**. There is no `Authorization` header option; every
browser WebSocket client has this constraint.

That's a real trade-off — URLs end up in proxy logs and browser history — and
it's why chat tokens are designed the way they are:

- Short-lived (1 hour by default, 6 hours maximum, no non-expiring option).
- Revocable, with revocation checked on every connect.
- Scoped to one user and optionally to specific conversations.
- Signed with `CHAT_TOKEN_SECRET`, which must differ from `JWT_SECRET` in
  production — the API refuses to start otherwise.

Never send a project API key here. It would be a permanent, project-wide
credential sitting in a URL.

### Token claims

```json
{
  "jti": "ctk_7Qd2nF...",
  "sub": "user-123",
  "pid": "<project uuid>",
  "cvs": ["<conversation uuid>"],
  "scopes": ["chat:read", "chat:send"],
  "iat": 1787054953,
  "exp": 1787058553,
  "aud": "raven-chat",
  "iss": "raven"
}
```

`aud` is fixed at `raven-chat`, which is what stops a dashboard session JWT or
an RTC token being replayed here even in the impossible case of a shared key.

### Origin

Browsers always send `Origin` on an upgrade, and page JavaScript cannot forge
it. Raven checks it against `CORS_ORIGIN` and rejects a mismatch with close
code `4403`.

A *missing* `Origin` is allowed — non-browser clients (a server-side bot, a
load test) legitimately don't send one, and rejecting them would break
legitimate use without stopping the attack the check exists for.

## Close codes

Application close codes live in 4000–4999 (RFC 6455 §7.4.2). Raven Chat's are
distinct from the RTC signaling plane's, so a close code in devtools tells you
which plane produced it.

| Code | Meaning | Reconnect? |
| --- | --- | --- |
| `1000` | Normal closure | No — this was intentional |
| `4401` | Authentication failed | **No.** Retrying a bad token can't help |
| `4403` | Origin not allowed | **No** |
| `4429` | Connection rate limit | Yes, after backing off |
| `4440` | Token expired | Yes, with a **fresh token** |
| `4500` | Server shutting down | Yes, immediately — this is a deploy, not a fault |

The SDK treats `4401` and `4403` as terminal and reports `failed` rather than
retrying forever.

## Frame format

Every frame is a JSON object with a `type`. Flat fields, no envelope
wrapping — a client can read one in devtools without decoding anything.

Frames that carry an `id` get a correlated `ack` or `error` back with the same
`id`. That's how a request/response call is built on a socket that is
otherwise a one-way event stream.

### Client → server

| Type | Fields | Notes |
| --- | --- | --- |
| `room.join` | `room` | Subscribe. Authorization is checked here |
| `room.leave` | `room` | |
| `message.send` | `room`, `text`, `messageType?`, `replyTo?`, `clientMessageId?`, `attachmentId?`, `metadata?`, `clientSentAt?` | |
| `message.update` | `messageId`, `text` | Author only |
| `message.delete` | `messageId` | Author, or `chat:moderate` |
| `reaction.add` | `messageId`, `emoji` | Idempotent |
| `reaction.remove` | `messageId`, `emoji` | Idempotent |
| `typing.start` | `room` | |
| `typing.stop` | `room` | |
| `read.mark` | `messageId` | Marks this and everything before it |
| `presence.set` | `status` | `online`, `away`, `offline` |
| `ping` | — | Application-level; distinct from the protocol ping |

### Server → client

| Type | Carries |
| --- | --- |
| `connected` | `connectionId`, `userId`, `scopes`, `expiresAt`, `heartbeatIntervalMs` |
| `ack` | `id`, `ok`, `data` |
| `error` | `id?`, `code`, `message`, `retryAfterSeconds?` |
| `room.joined` | `room`, `name`, `presence[]`, `typing[]` |
| `room.left` | `room` |
| `message` | `message` |
| `message.updated` | `message` |
| `message.deleted` | `messageId`, `roomId`, `deletedAt`, `deletedBy` |
| `reaction.added` / `reaction.removed` | `messageId`, `roomId`, `userId`, `emoji`, `at` |
| `typing.started` / `typing.stopped` | `roomId`, `userId` |
| `presence` | `roomId`, `userId`, `status`, `at` |
| `read` | `roomId`, `userId`, `messageId`, `at` |
| `pong` | `id?` |

**Unknown types must be ignored, not rejected.** A newer server may send
frames an older client doesn't know; throwing on one would break a client on
an upgrade it didn't ask for.

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
    "status":"stored","deduplicated":false,"persistLatencyMs":4,
    "message":{"id":"msg_3xR…","senderId":"alice","createdAt":"…"}}}
←  {"type":"message","message":{"id":"msg_3xR…", …}}
```

Note the last two frames. The `ack` is the *durability* signal, correlated to
the request. The `message` frame is the *fan-out*, and the sender receives it
too — so every participant, sender included, renders the same server-ordered
row rather than a locally-guessed one.

`room.joined` carries the current presence and typing state, so a client
joining mid-conversation isn't blind until the next event fires.

## Heartbeats

The gateway sends a protocol-level ping every 25 seconds. A client that
doesn't pong before the next cycle is terminated and cleaned up: presence
cleared, subscriptions released, connection record closed.

The same pass refreshes the Redis TTLs behind presence and connection
routing. Coupling liveness and refresh is deliberate — a connection that can
still answer a ping is exactly the one whose presence should stay alive, and
tying them together means the two can't disagree.

Browsers answer protocol pings automatically. The `ping` frame in the table
above is a separate, application-level thing for clients that want to measure
round-trip time.

## Reconnection

The socket will drop. Networks change, load balancers recycle, deploys
happen. What a client must do:

1. **Back off exponentially, with jitter, and with a cap.** When a gateway
   restarts, every client it was holding wakes at the same instant; without
   jitter they retry in lockstep and re-create the thundering herd on each
   attempt.
2. **Give up eventually.** An unbounded retry loop against a server that's
   already having a bad day is an attack, not a feature.
3. **Don't retry `4401`/`4403`.** Retrying a revoked token is a polite
   denial-of-service against yourself.
4. **Re-join rooms.** The new socket knows nothing about the old one's
   subscriptions.
5. **Refetch missed history.** The socket is not the source of truth. Use
   `after` with a cursor from the newest message you hold.
6. **Reuse `clientMessageId` on retries.** That's what makes a retry safe.

`@ravenkash/chat` does all six. If you're writing your own client, this list is
the contract.

## Errors

```json
{ "type": "error", "id": "m1", "code": "MESSAGE_TOO_LARGE",
  "message": "Message text is 5000 characters — the limit is 4000" }
```

An `error` carrying an `id` belongs to that request; one without is
connection-level. Codes are stable and enumerated in
[../error-codes.md](../error-codes.md).

Raw infrastructure errors never reach a client. A Postgres constraint
violation, a Redis timeout, or an unhandled exception is logged server-side in
full and surfaces as `INTERNAL_ERROR` — a client shouldn't be able to learn
your schema from an error message.
