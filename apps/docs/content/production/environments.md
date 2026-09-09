---
title: Environments
description: Development, staging, and production — isolated all the way down, not just by name.
---

Every Raven project has three environments:

```
Project
├── development   (the default, everywhere)
├── staging
└── production
```

They are fixed — you cannot add a fourth — and they isolate credentials
and data from each other completely.

## What is isolated

| | Isolated by environment |
|---|---|
| API keys | ✅ A key belongs to exactly one environment |
| Chat tokens | ✅ Inherited from the key that minted them |
| Rooms | ✅ Including their names |
| Conversations | ✅ Including their names |
| Webhook endpoints | ✅ A staging endpoint never receives production events |
| Connections, errors, usage | ✅ Tagged, so metrics can be read per environment |

What is *not* isolated: the project itself, its name, and who can
administer it. Environments separate traffic, not ownership.

## Creating a key

```bash
raven keys create --name backend --environment production
```

```
✔ API key created for the production environment.

Save this key now. It will not be shown again.

rvk_prod_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk

This is a production key. Keep it server-side — never in an app bundle
or a committed file.
```

`--environment` accepts `dev`/`development`, `stg`/`staging`,
`prod`/`production`, in any case. An unrecognised value is refused rather
than defaulted: quietly issuing a development key to someone who typed
`--environment prd` is the worst available outcome.

Omitting it gives you **development**. A wrong guess should land somewhere
harmless.

### Reading a key at a glance

The environment is written into the key's public half:

```
rvk_dev_8Kd2nQxwYtLm     development
rvk_stg_2mNpQ4rZ7xKw     staging
rvk_prod_9YtL1nB2xQcR    production
```

This is decoration for humans, not a claim. The server reads the
environment from the key's database row, never from its text — editing the
prefix changes nothing, and keys issued before this existed have no
segment and keep working exactly as they did.

## How an environment is decided

Never by the request. Always by the credential.

```
API key  ──carries──►  environment
   │
   │ mints
   ▼
Chat token  ──signed `env` claim──►  same environment
   │
   ▼
Browser
```

A backend holding a development key cannot mint a production chat token,
and a browser cannot reach production data by changing a request field —
for the same reason it cannot forge `senderId`. Both are signed claims,
not parameters.

Dashboard and CLI routes are the exception: there the caller is a
logged-in developer, so they pass `?environment=` and it defaults to
development. Those routes are authenticated by a session, not by a key,
so there is no key to read it from.

## What isolation looks like in practice

The same room name in two environments is two different rooms:

```bash
# Development
curl -H "Authorization: Bearer $DEV_KEY" -d '{"name":"lobby"}' .../v1/rooms
# Production — not a conflict
curl -H "Authorization: Bearer $PROD_KEY" -d '{"name":"lobby"}' .../v1/rooms
```

And a key cannot see across the boundary, even holding an exact id:

```bash
curl -H "Authorization: Bearer $DEV_KEY" .../v1/rooms/<the production room id>
# 404  { "code": "RAVEN_ROOM_NOT_FOUND" }
```

That is **404, not 403**, deliberately. A 403 would confirm the id is real
somewhere, which is exactly what someone probing ids wants to learn. The
same rule applies to conversations, messages, and RTC tokens.

## Webhooks

An endpoint is registered for one environment:

```json
POST /v1/projects/{id}/webhooks
{ "url": "https://api.example.com/hooks", "environment": "PRODUCTION" }
```

and every delivered event says which environment it came from:

```json
{
  "id": "evt_9f2c41ab77e0",
  "type": "message.created",
  "projectId": "…",
  "environment": "PRODUCTION",
  "createdAt": "2026-08-19T09:31:04.221Z",
  "data": { }
}
```

Getting this wrong is worse than a missed delivery — it means real
customer data posted to whatever URL someone pointed at their laptop while
testing. So endpoints are matched on environment before anything is
queued, not filtered afterwards.

## Migrating an existing project

Everything that existed before environments is **development**. That is
true of API keys, rooms, conversations, webhook endpoints and stored
telemetry, and nothing changed behaviourally: a project that never
mentions environments behaves exactly as it did.

To adopt them:

1. `raven keys create --environment production` for your production backend.
2. Register a production webhook endpoint if you use webhooks.
3. Swap the key in your production deployment.
4. Revoke the old key once nothing is using it.

Your development traffic is unaffected throughout, because it was already
in the development environment.

## A note on the word "environment"

Raven uses it for a *project's* environment. It is unrelated to `NODE_ENV`
or how the Raven server itself was deployed — a single Raven deployment
serves all three project environments. Where the codebase needs the
deployment's own mode (the webhook SSRF guard, for one) it is called
`deploymentEnv` to keep the two apart.

## One caveat, at the deployment level

Everything above is enforced at the application layer and holds. There is a
separate, deployment-level way to lose part of it:

**The media-server fleet registry is global to the database.** If your
environments share one Postgres instance, `rtc_servers` is one table, and a
development media server registers into the same fleet production allocates
from. Room allocation prefers the requested region but falls back to any
region rather than failing the call — so a production room can be handed to
a laptop.

Use a separate database per environment. This is the single
highest-value thing to get right when self-hosting, and it is recorded in
[Known limitations](/reference/known-limitations).

## Next steps

- [Environment concept](/concepts/environment) · [API keys](/authentication/api-keys)
- [Production checklist](/production/checklist)
