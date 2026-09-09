---
title: Docker Compose
description: The whole stack on one machine, and the one dependency it deliberately leaves out.
---

## What you get

Redis, the SFU, coturn, MinIO, and the control plane. **Not** Postgres —
that is yours to point at.

## Bring it up

```bash
cp .env.example .env
# set DATABASE_URL and DIRECT_URL before anything else

pnpm install
pnpm infra:up          # Redis, SFU, coturn, MinIO, api
pnpm db:migrate        # apply migrations
pnpm infra:verify      # confirm every dependency is genuinely healthy
pnpm db:seed           # optional: a demo developer, project, key and room
```

The API is then at `http://localhost:4100`, with interactive schemas at
`http://localhost:4100/docs`.

```bash
pnpm infra:ps          # what is running
pnpm infra:logs        # follow logs
pnpm infra:down        # stop
pnpm infra:reset       # stop, wipe volumes, start again
```

## Postgres is not included

Deliberately. Raven's own deployment uses managed Postgres, and a database
in a throwaway Compose volume is the wrong default for something holding
every message you have.

You need two URLs:

```
DATABASE_URL=postgresql://user:pass@host:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://user:pass@host:5432/postgres
```

`DATABASE_URL` is what the running app uses and may point at a
transaction-mode pooler. `DIRECT_URL` is a session-mode connection used
**only** by the Prisma CLI for migrations — running a migration through a
transaction pooler fails in ways that are hard to read.

Any Postgres works: a managed instance, or one you run yourself.

## Generate your secrets

Do this before first boot, not after:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # RTC_TOKEN_SECRET
openssl rand -hex 32   # CHAT_TOKEN_SECRET
openssl rand -hex 32   # API_KEY_HASH_SECRET
openssl rand -hex 32   # SFU_REGISTRATION_SECRET
openssl rand -hex 32   # TURN_SECRET
```

`RTC_TOKEN_SECRET` and `CHAT_TOKEN_SECRET` fall back to `JWT_SECRET` so a
fresh clone boots at all. Production validation refuses that fallback at
start-up.

## Confirm it actually works

`pnpm infra:up` returning is not evidence. `infra:verify` checks each
dependency for real:

```bash
pnpm infra:verify
```

Then, from the API's own point of view:

```bash
curl http://localhost:4100/health/ready
```

`ready` reports each dependency individually — Postgres, Redis, the SFU,
TURN — so a stack that came up but cannot reach its relay says so instead
of reporting a green tick.

## The dashboard

Runs separately:

```bash
pnpm --filter @raven/dashboard dev     # http://localhost:3000
```

## Attachments

MinIO is in the stack, so chat attachments work locally once
`STORAGE_BUCKET` is set. Leave it unset and attachment endpoints return
`RAVEN_NOT_CONFIGURED` — the API says so out loud rather than
half-working.

## Next steps

- [Environment variables](/self-hosting/environment-variables) — everything the stack reads.
- [TURN & NAT traversal](/self-hosting/turn) — needed before a call works off your laptop.
- [Health & metrics](/self-hosting/health-and-metrics)
