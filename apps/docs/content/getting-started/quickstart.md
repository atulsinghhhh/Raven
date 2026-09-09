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

You also need the CLI or the dashboard to create your first API key. **The
Raven packages are not published to a registry yet**, so the CLI is
installed from a checkout — see
[Installing from source](/getting-started/installing-from-source).

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

## 2. Mint a token on your backend

Your backend decides who a user is from its own session — never from a
value the client sends. It asks Raven for a token scoped to exactly what
that user should be able to do.

```ts
// your backend
import { Raven } from '@ravenkash/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

app.post('/join-room', async (req, res) => {
  const room = await raven.rooms.create({ name: 'demo-room' });
  const token = await raven.tokens.create({
    room: room.id,
    identity: req.user.id,
    permissions: { join: true, publish: true, subscribe: true },
  });
  res.json(token); // { token, endpoint, iceServers, ... }
});
```

## 3. Connect from the client

Hand your backend's response straight to the SDK — never hand-construct
any of these fields yourself.

```ts
import { createRTCClient } from '@ravenkash/rtc';

const resp = await fetch('/join-room', { method: 'POST' }).then((r) => r.json());

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.endpoint,
  iceServers: resp.iceServers,
});

const room = await client.join('demo-room');
await room.enableCamera();
await room.enableMicrophone();
```

That's a working call. For chat, the same shape applies with a chat
token instead — see [Chat → Overview](/chat).

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
