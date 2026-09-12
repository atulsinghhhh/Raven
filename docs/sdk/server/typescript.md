# @ravenkash/server — TypeScript / Node.js server SDK

Backend-only. Mints short-lived RTC tokens and reads real project data
(rooms, connections, errors, metrics, diagnostics) using a permanent
project API key. **Never import this into browser/frontend code** — see
`docs/security/server-sdk.md`.

## Installation

```bash
npm install @ravenkash/server
```

Works with Node.js ≥20 (this repo's supported range), as both ESM
(`import`) and CommonJS (`require`) — the package ships both builds plus
full `.d.ts` types.

## Initialization

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL!, // https://api.ravenstack.online
});
```

`apiKey` is the only field the SDK *validates* unconditionally, but on its
own it is not enough: omitted, `baseUrl` defaults to `http://localhost:4100`,
so a client constructed with just a key talks to a local dev stack and fails
against any real deployment with `RAVEN_NETWORK_ERROR`. Pass both unless you
are genuinely running Livqeno on localhost. With `NODE_ENV=production`, the
SDK now throws `RAVEN_INVALID_CONFIG` immediately if `baseUrl` is missing,
rather than silently connecting to that local port.

The SDK **never reads `process.env.RAVEN_API_KEY`, `RAVEN_API_URL`, or any
other environment variable on its own** — you always pass them explicitly.
This is deliberate: automatic env scanning is an easy way to accidentally
pick up the wrong credential, or the wrong control plane.

```ts
new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: 'https://api.ravenstack.online',  // or your own deployment; defaults to http://localhost:4100
  timeout: 10_000,    // ms, defaults to 10000 — a request never hangs indefinitely
  maxRetries: 2,      // defaults to 2
});
```

## Resources

Every method below maps to a real, existing Control API endpoint — there
is no speculative surface here.

### `raven.projects`

```ts
const project = await raven.projects.get(); // the one project this API key belongs to
```

An API key is already permanently scoped to exactly one project — there
is no `list()`/`create()`/`update()`/`delete()` here. Those are
human/dashboard-session operations (see the CLI/dashboard docs), not
something a server key can or should do.

### `raven.tokens` — the core of this SDK

```ts
const token = await raven.tokens.create({
  room: roomId,          // a room's ID (from rooms.create()/rooms.list()), not its name
  identity: 'user-42',
  permissions: { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true },
  expiresIn: 3600,        // seconds; every token is short-lived by design — there is no permanent-token option
});
// { token, endpoint, iceServers, telemetryUrl, expiresAt, ... }
```

Hand this response straight to your frontend, which passes it into
`createRTCClient()` from `@ravenkash/rtc` — see `examples/node-server` and
the full flow in `docs/security/server-sdk.md#authorization-model`.
**Never mint a token in the browser, and never log or store a minted
token any longer than it takes to forward it.**

### `raven.rooms`

```ts
await raven.rooms.list();
await raven.rooms.get(roomId);
await raven.rooms.create({ name: 'lobby' });
await raven.rooms.delete(roomId); // soft-closes (status: CLOSED) — never a hard delete
```

### `raven.rooms.participants`

```ts
const participants = await raven.rooms.participants.list(roomId);
// null = the SFU couldn't be reached; [] = genuinely empty — never coerced together
const one = await raven.rooms.participants.get(roomId, 'user-42'); // null if not present
```

This is always the SFU's **live** state — there's no stored join/leave
history in the Control API yet, and no way to remove/kick a participant
through this SDK (that capability doesn't exist in the Control API
today — see Known Limitations).

### `raven.connections` / `raven.errors` (Phase 9 observability)

```ts
await raven.connections.list({ roomId, state: 'CONNECTED', limit: 50 });
await raven.connections.get(connectionId);

await raven.errors.list({ category: 'ICE_ERROR', connectionId, limit: 50 });
await raven.errors.get(errorId);
```

Typed filters only — never an arbitrary query string. See
`docs/error-codes.md` for the full category list and
`docs/observability.md` for the data model.

### `raven.metrics` / `raven.diagnostics`

```ts
await raven.metrics.get('1h'); // '15m' | '1h' | '24h' | '7d' — real aggregates, this is also today's "usage" view
await raven.diagnostics.get(); // signaling/SFU/TURN health + this project's real active-connection count
```

### `raven.chat`

Mints browser chat credentials and manages conversations server-side.

```ts
const grant = await raven.chat.createToken({ userId: 'user-42', conversations: [conversationId] });
// { token, chatUrl, apiUrl, scopes, conversations, expiresAt, ... }
```

Forward that response to your frontend and hand it to `createChatClient()`
from `@ravenkash/chat`. `chatUrl` and `apiUrl` are in it precisely so the
browser never configures a WebSocket address; a chat token carries no
address of its own to derive one from.

Conversations and membership:

```ts
const conversation = await raven.chat.createConversation({ type: 'GROUP', name: 'launch-team' });
await raven.chat.addMember(conversation.room, { userId: 'user-42', role: 'MODERATOR' });
await raven.chat.listMembers(conversation.room);
await raven.chat.removeMember(conversation.room, 'user-42');
```

Messages, including posting as your own backend rather than as a user —
useful for system notices and bots:

```ts
await raven.chat.sendMessage(room, { text: 'Deploy finished', type: 'SYSTEM' });
const page = await raven.chat.listMessages(room, { limit: 50 });
await raven.chat.deleteMessage(messageId);
```

### `raven.live` (also `raven.liveStreams`)

Livqeno Live Streaming: one host, optional co-hosts, many viewers. Both names
are the same object, so pick whichever reads better.

```ts
const stream = await raven.live.create({ title: 'Launch day', hostIdentity: 'user-42' });
await raven.live.start(stream.id);
// ... later
await raven.live.end(stream.id);   // terminal; create a new stream to go again
```

**Host and viewer credentials come from different methods, and that is the
security boundary.** The role is decided by which method you call, never by
a field in a request body, so a viewer cannot ask to publish:

```ts
// Publish access. Call it only after your own authorization check.
const host = await raven.live.addHost(stream.id, { identity: 'user-42', role: 'CO_HOST' });

// Always subscribe-only on RTC, always MEMBER on chat. No way to widen it.
const viewer = await raven.live.createViewerToken(stream.id, 'user-99');
```

Both return the same shape — `{ identity, role, rtc, chat? }` — where `rtc`
is an ordinary RTC grant for `createRTCClient()` and `chat` an ordinary chat
grant for `createChatClient()`. A stream is an RTC room and a chat
conversation composed together, not a third realtime system: `stream.conversationId`
is the conversation, so stream chat is Livqeno Chat with no extra API to learn.

```ts
const stream = await raven.live.get(streamId);
stream.viewerCount;      // live count, or null when the SFU was unreachable
stream.conversationId;   // the stream's chat conversation
```

`viewerCount` is `null`, never `0`, when the SFU could not be reached. The
two are different facts and Livqeno does not collapse them.

## Error model

```ts
import { RavenError, isRavenError } from '@ravenkash/server';

try {
  await raven.rooms.get('missing-room');
} catch (error) {
  if (isRavenError(error)) {
    console.log(error.code);       // e.g. 'NOT_FOUND'
    console.log(error.statusCode); // e.g. 404
    console.log(error.requestId);  // correlates with the Control API's own x-request-id
  }
}
```

`RavenError` is built entirely from the parsed response body and
response headers — never from anything that could carry your API key.
It never includes a stack trace from the server, a database error, or
TURN/RTC credentials.

## Retries

Transient failures only — network errors, timeouts, and HTTP
429/502/503/504 — retried with bounded exponential backoff
(`maxRetries`, default 2). **Never retried**: 400/401/403/404 or any
other 4xx — those are never transient. Pass `retryable: false` on the
few call sites that need it (none of the public resource methods expose
this directly; it's an internal `RavenHttpClient` option).

## Timeouts

`timeout` (ms, default 10000) bounds every request via `AbortController`
— a call never hangs indefinitely, even against an unreachable host.

## Pagination

The Control API doesn't paginate large collections yet (no cursor/
`nextCursor`/`hasMore` shape anywhere) — every `list()` call returns a
flat array, optionally capped with `limit` where the endpoint supports
it (`connections`, `errors`). This SDK does not invent cursor pagination
that doesn't exist server-side.

## Idempotency

Not supported — the Control API has no idempotency-key handling today.
No idempotency behavior is invented here either.

## Security

- The API key lives only in a private (`#`-prefixed) class field —
  never a normal property, never visible via `Object.keys()`,
  `JSON.stringify()`, or `console.log()` of the client.
- Never logged, never included in a thrown `RavenError`.
- See `docs/security/server-sdk.md` for the full model.

## Framework compatibility

Works with Express, Fastify, NestJS, a Next.js server/route handler, or
plain Node — it's a plain class with promise-based methods, no framework
assumptions. See `examples/node-server` (Express).

## Known limitations

- No webhook *methods on this SDK*. The Control API does have webhooks —
  CRUD, HMAC-SHA256 signatures and automatic retries, see
  [`apps/docs/content/webhooks.md`](../../../apps/docs/content/webhooks.md) — but they are managed through JWT-guarded
  (dashboard-session) endpoints, and this SDK authenticates with a project
  API key. So there is nothing for it to call, rather than nothing to
  build against. Manage endpoints from the dashboard, and verify incoming
  deliveries with the signature scheme documented there.
- No participant "remove/kick" — no such capability exists in the
  Control API yet.
- No idempotency keys, no cursor pagination (see above — not invented).
- No usage-metering/billing beyond `raven.metrics.get()`.
