---
title: Architecture
description: The control plane, the RTC plane, and how tokens connect them.
---

Raven is two planes that share one control plane, and neither depends on
the other at runtime.

```
                 Raven Control Plane
        (projects, environments, tokens, roles)
                       │
        ┌──────────────┴──────────────┐
        │                             │
     RTC plane                    Chat plane
        │                             │
   LiveKit (SFU)              Postgres + Redis
   coturn (TURN/STUN)         WebSocket gateway
```

**The control plane** (`apps/api`) is a NestJS service backed by
PostgreSQL and Redis. It owns projects, environments, API keys,
short-lived tokens, roles, webhooks, and the audit log. Every other
piece — the RTC plane, the chat plane, every SDK — is a client of this
one control plane, not a second source of truth.

**The RTC plane** uses [LiveKit](https://livekit.io) as the SFU and
[coturn](https://github.com/coturn/coturn) for TURN/STUN. Raven doesn't
reimplement WebRTC media routing — that's a solved, hard problem, and
duplicating it would only make Raven worse at the part it doesn't need
to own. What Raven owns here is the token that authorizes a client to
join, and everything upstream of the SFU (project scoping, room
identity, environment isolation).

**The chat plane** is entirely separate infrastructure: its own
WebSocket gateway at `/v1/chat/ws`, PostgreSQL as the durable source of
truth for messages, Redis for presence and fan-out only. A message is
acknowledged only once it's durably stored. Either plane can be used
without the other — an app can be calling-only, chat-only, or both —
and a failure in one never takes down the other.

## The token model

Nothing reaches a browser or a mobile client except a short-lived token.

```
Your backend (holds the API key)
        │
        │ POST /v1/rooms/{id}/rtc-tokens   or   POST /v1/chat/tokens
        ▼
Raven control plane
        │
        │ a token scoped to one room/conversation,
        │ one identity, and an explicit set of permissions
        ▼
Your client (browser, mobile, or server)
```

Your API key never leaves your backend. See
[Authentication](/getting-started/authentication) for the full model,
and [Environments](/production/environments) for how development,
staging, and production stay isolated from each other.

## Repository layout

```
apps/api          Control plane — NestJS, Prisma/PostgreSQL, Redis
apps/dashboard    Developer console (Next.js)
apps/www          This site's neighbor — the marketing site
apps/docs         What you're reading now
packages/sdk      @raven/rtc — browser RTC SDK
packages/chat-sdk @raven/chat — browser chat SDK
packages/react-sdk        @raven/react — hooks/components over both
packages/react-native-sdk @raven/react-native
packages/server-sdk       @raven/server — server-side TypeScript
packages/cli      @raven/cli — the `raven` command
sdks/python       raven-sdk — server-side Python
sdks/flutter      raven_rtc, raven_chat
```

## Why this split

Putting RTC and chat on genuinely separate infrastructure, rather than
routing chat messages through the same signaling channel as call
metadata, means a chat outage is never a call outage and vice versa.
It costs an extra WebSocket connection when an app uses both — a small,
deliberate price for that isolation.
