---
title: Server SDK (TypeScript)
description: '@raven/server — the same resources as raven-sdk, in TypeScript.'
---

`@raven/server` is the TypeScript counterpart to [the Python SDK](/sdk/python)
— same resources, same guarantees, idiomatic to the runtime.

## Install

```bash
npm install @raven/server
```

## Initialization

```ts
import { Raven } from '@raven/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });
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
```

## Errors

```ts
import { RavenError } from '@raven/server';

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
timeouts, 429/502/503/504) retry with bounded exponential backoff;
4xx never does. `timeout` bounds every request. Chat history is
cursor-paginated; every other list endpoint returns a flat array,
optionally capped with `limit`.

## Security

The API key lives in a private class field (`#apiKey`) — never a plain
enumerable property, never included in `JSON.stringify()` of the client,
never logged, never in a thrown error. See
[Authentication](/getting-started/authentication).

## Framework compatibility

Works in any Node.js server context — Express, Fastify, Next.js Route
Handlers, a serverless function. It's a plain HTTP client with no
framework-specific code path; nothing about it assumes a particular
server.
