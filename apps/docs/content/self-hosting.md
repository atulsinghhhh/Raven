---
title: Self-hosting
description: Raven is open source. What you run, what it needs, and what is not solved for you yet.
---

Raven runs on your own infrastructure. This section covers the stack, its
configuration, and the parts that are genuinely operational work.

## What you run

```
                    ┌──────────────────────────┐
   your backend ───▶│  Control plane (apps/api)│──▶ Postgres
                    │  REST + 2 WebSockets     │──▶ Redis
   your frontend ──▶│                          │──▶ object storage (optional)
                    └────────────┬─────────────┘
                                 │ allocates, heartbeats
                                 ▼
                    ┌──────────────────────────┐
                    │  SFU (services/sfu, Go)  │◀── media (SRTP)
                    └────────────┬─────────────┘
                                 │ relays when no direct path
                                 ▼
                    ┌──────────────────────────┐
                    │  coturn (TURN/STUN)      │
                    └──────────────────────────┘
```

| Component | What it is | Required |
|---|---|---|
| Control plane | NestJS. REST API, signaling WebSocket, chat WebSocket, background workers | Yes |
| Postgres | Every durable record | Yes — **not** in the Compose stack |
| Redis | Presence, typing, rate limits, fan-out, locks | Yes |
| SFU | Go + Pion. Forwards media | Yes, for RTC |
| coturn | TURN/STUN relay | Yes, in practice — see [TURN](/self-hosting/turn) |
| Object storage | S3-compatible, for chat attachments | Only for attachments |
| Dashboard, docs, marketing site | Next.js apps | No |

The control plane never carries audio or video. That is the SFU's job, and
it stays that way.

## Get it running

1. [Docker Compose](/self-hosting/docker-compose) — the whole stack locally.
2. [Environment variables](/self-hosting/environment-variables) — all 92, with the four that break first.
3. [TURN & NAT traversal](/self-hosting/turn) — the part that decides whether calls connect.
4. [Running the SFU](/self-hosting/sfu) — registration, heartbeats, draining.
5. [Health & metrics](/self-hosting/health-and-metrics) — what to probe and scrape.

## Be aware before you commit

Self-hosting Raven means owning a media path, and that is real work:

- **Postgres is yours to run.** The Compose stack deliberately does not
  include it. Any Postgres works.
- **TURN needs a public address and open UDP.** Behind NAT with a
  container-internal `TURN_HOST`, no client can reach the relay.
- **The SFU fleet registry is global to the database.** A development SFU
  registering against a shared database can be allocated a production
  room. Split your databases per environment — see
  [Known limitations](/reference/known-limitations).
- **Only Chromium has been exercised with real media.** Support is
  feature-detected, so an untested browser reports as supported; that is a
  claim about capabilities, not about interop.

## Next steps

- [Docker Compose](/self-hosting/docker-compose) — start here.
- [Production checklist](/production/checklist) · [Known limitations](/reference/known-limitations)
