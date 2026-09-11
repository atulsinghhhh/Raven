---
title: Node.js SDK
description: '@ravenkash/server — server-side RTC and chat for Node.js. Same resources as the Python SDK.'
---

`@ravenkash/server` is the Node.js/TypeScript counterpart to
[the Python SDK](/sdk/python) — same resources, same guarantees,
idiomatic to the runtime.

## Install

```bash
npm install @ravenkash/server
```

## Initialization

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY,
  baseUrl: process.env.RAVEN_API_URL, // https://api.ravenstack.online
});
```

Passed explicitly — the SDK never reads `process.env` implicitly.

## Resources

```ts
// Projects
await raven.projects.get(); // the one project this key belongs to

// RTC tokens — the core of this SDK
const token = await raven.tokens.create({
  room: roomId,
  identity: 'user-42',
  permissions: { join: true, publish: true, subscribe: true },
  expiresIn: 3600,
});

// Rooms
await raven.rooms.create({ name: 'demo-room' });
await raven.rooms.list();
await raven.rooms.get(roomId);
await raven.rooms.participants.list(roomId); // null means the SFU couldn't be reached — distinct from a genuinely empty room ([])

// Observability
await raven.connections.list();
await raven.errors.list();
await raven.metrics.get('1h'); // '15m' | '1h' | '24h' | '7d'
await raven.diagnostics.get();

// Chat — see Chat Overview and the Python SDK page for the full surface
await raven.chat.createConversation({ name: 'support-room-42' });
await raven.chat.createToken({ userId: 'alice', conversations: [conv.publicId] });

// Live Streaming — see below
await raven.liveStreams.create({ title: 'Friday Q&A', hostIdentity: 'user-123' });
```

## Live Streaming

```ts
const stream = await raven.liveStreams.create({
  title: 'Friday Q&A',
  hostIdentity: 'user-123', // registered as this stream's HOST
});

await raven.liveStreams.start(stream.id);

// Registering a co-host mints full-publish RTC + moderator chat credentials
// in one call. Hand the result to the client SDK unchanged.
const hostCredential = await raven.liveStreams.addHost(stream.id, { identity: 'user-456' });

// A viewer token is always subscribe-only — there is no field here that
// can request publish access.
const viewerCredential = await raven.liveStreams.createViewerToken(stream.id, 'user-789');

await raven.liveStreams.removeHost(stream.id, 'user-456');
await raven.liveStreams.end(stream.id); // LIVE → ENDED, terminal
```

`get()`/`list()` read back a stream's metadata, registered hosts, and
(for `get()`) a live viewer count polled from the SFU. `addHost()` and
`createViewerToken()` are the security-critical methods: the role your
caller ends up with is determined entirely by which one you call, never
by a field in the request body. See
[Live Streaming Overview](/live-streaming) for the full concept model,
and [SDK Support Matrix](/live-streaming/sdk-support) for what every SDK
implements.

## Errors

```ts
import { RavenError } from '@ravenkash/server';

try {
  await raven.rooms.get('missing-room');
} catch (error) {
  if (error instanceof RavenError) {
    console.log(error.code, error.statusCode, error.requestId);
  }
}
```

Built entirely from the parsed response body and headers — never a raw
server stack trace, database error, or RTC/TURN credential. See
[Error Codes](/reference/errors).

## Retries, timeouts, pagination

Same model as the Python SDK: transient failures (network errors,
timeouts, 429/502/503/504) retry with bounded exponential backoff; no
other 4xx does. `timeout` bounds every request. Chat history is
cursor-paginated; every other list endpoint returns a flat array,
optionally capped with `limit`.

## Security

The API key lives in a private class field (`#apiKey`) — never a plain
enumerable property, never included in `JSON.stringify()` of the client,
never logged, never in a thrown error. See
[Authentication](/authentication).

## Framework compatibility

Works in any Node.js server context — Express, Fastify, Next.js Route
Handlers, a serverless function. It's a plain HTTP client with no
framework-specific code path; nothing about it assumes a particular
server.
