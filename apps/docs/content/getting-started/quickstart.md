---
title: Quickstart
description: A project, a token, and your first call or message.
---

This walks through the shortest real path from nothing to a working
connection: create a project, mint a token on your backend, connect from
a client.

## Before you start

Raven is software that runs somewhere, so you need one of two things:

- **A Raven deployment you can reach** — your team's, or a hosted one. Its
  dashboard is linked in the top bar of this site.
- **A local one.** `docker compose up` brings up everything except
  Postgres. See [Docker Compose](/self-hosting/docker-compose).

You also need the dashboard or the CLI to create your first API key.

Every Raven SDK is published on npm under the `@ravenkash` scope, so
nothing here needs a checkout. The two you want for a first integration are
the backend one and the browser one:

```bash
npm install @ravenkash/server   # your backend — holds the API key
npm install @ravenkash/rtc      # your browser app — holds only a grant
```

Add `@ravenkash/chat` for messaging, `@ravenkash/react` for hooks, or
`@ravenkash/cli` (`npm install -g @ravenkash/cli`) for the `raven` command
used below. The full list is on
[Install an SDK](/get-started/install-an-sdk).

Python is the one exception: Raven's Python SDK is **not** on PyPI, and the
name `raven-sdk` there belongs to an unrelated project — see
[Python SDK](/sdk/python) before installing anything.

## 1. Create a project and a key

### If you are running Raven locally

The seed script is the fastest route to a working credential. It creates a
demo developer, project and room, and **prints an API key**:

```bash
pnpm db:seed
```

```
Seed complete:
  Developer login: demo@raven.local / demo-password-123
  Project: Demo Project (…)
  Room: demo-room (…)
  API key (shown once — this run only): rvk_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk
```

Copy that key and skip to step 2. Re-running the seed is safe, but it will
not print the key again — it only shows a secret it just created.

### If you are using an existing deployment

Register in that deployment's dashboard and create a project. Every project
starts with a development environment — safe to experiment in, isolated
from staging and production. Then create an API key scoped to it:

```bash
raven login
raven keys create --name backend --environment development
```

This prints the key exactly once:

```
rvk_dev_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk
```

Store it as `RAVEN_API_KEY` on your backend. It never goes anywhere
else — not a mobile app, not a browser bundle, not a committed file.

## 2. Allow the origin your frontend runs on

Raven checks the browser's `Origin` on every SDK connection, so the page
you are about to build has to be on the project's list before it can
connect. Dashboard → your project → **Settings → Security → Allowed
Origins**.

Two things worth knowing before you go looking for a problem you do not
have:

- **Localhost is allowed by default**, on any port. `http://localhost:3000`
  and `http://localhost:5173` both work with nothing configured, so you can
  skip this step entirely until you deploy.
- **An empty list means "no restriction yet."** Enforcement switches on for
  a project the moment it has its first entry, which is also the moment you
  should add every origin you serve from — one line per scheme+host+port,
  no wildcards.

A connection from an origin that is not on a non-empty list is refused with
`ORIGIN_NOT_ALLOWED` rather than a silent browser CORS failure, so the
cause is visible in your console. The reasoning, and the full model, is in
[Browser security & CORS](/authentication/browser-security).

## 3. Mint a grant on your backend

Your backend decides who a user is from its own session — never from a
value the client sends. It asks Raven for a token scoped to exactly what
that user should be able to do.

```ts
// your backend
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY,
  baseUrl: process.env.RAVEN_API_URL, // https://api.ravenstack.online
});

app.post('/join-room', async (req, res) => {
  const room = await raven.rooms.create({ name: 'demo-room' });
  const grant = await raven.tokens.create({
    room: room.id,
    identity: req.user.id,
    permissions: { join: true, publish: true, subscribe: true },
  });
  // Everything the browser needs, and nothing it shouldn't have.
  res.json(grant); // { token, endpoint, iceServers, telemetryUrl, roomName, ... }
});
```

## 4. Return the grant to the browser and connect

Hand your backend's response to the SDK whole. Every field in it —
`endpoint`, `iceServers`, `telemetryUrl` — is an address Raven chose for
this session, and picking them apart is how people end up hard-coding
infrastructure that is meant to move without an SDK release.

```ts
import { createRTCClient } from '@ravenkash/rtc';

const grant = await fetch('/join-room', { method: 'POST' }).then((r) => r.json());

const room = await createRTCClient(grant).join(grant.roomName);

await room.enableCamera();
await room.enableMicrophone();
```

That's a working call. Nothing above configures an SFU, a TURN server, ICE
credentials or a WebSocket address, and nothing needs to: the grant carries
them, and your two environment variables stay `RAVEN_API_KEY` and
`RAVEN_API_URL`.

## 5. Add chat to the same app

Chat is a second grant of the same shape, minted by the same backend from
the same API key, and it is entirely independent of RTC — you can use
either without the other.

```ts
// your backend
const chat = await raven.chat.createToken({
  userId: req.user.id,
  conversations: ['demo-room'],
});
res.json(chat); // { token, chatUrl, apiUrl, scopes, ... }
```

```ts
// your browser app
import { createChatClient } from '@ravenkash/chat';

const grant = await fetch('/chat-token', { method: 'POST' }).then((r) => r.json());

const client = createChatClient(grant);
await client.connect();

client.on('message', (message) => console.log(message.text));
await client.sendMessage({ room: 'demo-room', text: 'hello from the quickstart' });
```

The conversation has to exist first — `raven.chat.createConversation({ name:
'demo-room' })` — and the grant is scoped to exactly the conversations you
name, so a browser holding it cannot read a room you did not list. See
[Chat → Overview](/chat) for the rest.

## Local development

Running Raven's own control plane locally, rather than against a hosted
instance:

```bash
cp .env.example .env
pnpm infra:up       # Redis, the media server, TURN, the API
pnpm infra:verify   # confirms everything is healthy
pnpm db:migrate     # apply migrations to your Postgres
pnpm db:seed        # optional: a demo developer + project + key + room
```

`.env` needs a `DATABASE_URL` and `DIRECT_URL` before any of this works —
Postgres is not part of the compose stack. Any Postgres will do; Raven's
own deployment uses managed Postgres on Supabase, whose free tier gives you
both connection strings in a couple of minutes.

Interactive API docs are then at `http://localhost:4100/docs`.

## Next

- [Authentication](/authentication) — the full token
  model, and why the client never sees your API key.
- [RTC → Overview](/rtc) — rooms, participants, and everything
  a call needs beyond join/publish.
- [Chat → Overview](/chat) — conversations, messages, and
  presence.
