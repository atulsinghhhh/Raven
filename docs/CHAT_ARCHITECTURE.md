# Livqeno Chat — Architecture

This document explains the **current** architecture (verified against source, not aspirational) and the **target** architecture that closes the gaps identified in `CHAT_GAP_AUDIT.md`. It is scoped to the Chat module (`apps/api/src/modules/chat`), separate from the RTC/signaling plane — the two share nothing but an optional `Conversation.roomId` link, and either can fail without taking the other down.

---

## 1. Current architecture

```
┌─────────────┐      ┌──────────────────────────────────────────────────┐
│  Client SDK │      │                  API process (NestJS)              │
│ (Web/Flutter│      │  ┌────────────────────────────────────────────┐   │
│ /RN/React)  │      │  │           WebSocket Gateway (raw `ws`)       │   │
└──────┬──────┘      │  │  - auth handshake (token in query param)     │   │
       │  WSS        │  │  - heartbeat (25s ping/pong)                 │   │
       │─────────────┼─▶│  - in-process session/room maps              │   │
       │             │  │  - frame validation (size/shape/type)        │   │
       │  REST/HTTPS │  └───────────────┬────────────────────────────┘   │
       │─────────────┼─▶┌───────────────▼────────────────────────────┐   │
       │             │  │              Chat Service layer              │   │
       │             │  │  MessagesService · ConversationsService      │   │
       │             │  │  ReactionsService · ReadStateService          │   │
       │             │  │  PresenceService · TypingService              │   │
       │             │  │  ChatTokenService · ChatRateLimitService      │   │
       │             │  │  AttachmentsService · ChatRetentionService    │   │
       │             │  └──────┬──────────────────┬────────────────────┘   │
       │             │         │                  │                        │
       │             │         ▼                  ▼                        │
       │             │  ┌────────────┐   ┌─────────────────────────┐      │
       │             │  │ PostgreSQL │   │   ChatEventsService       │      │
       │             │  │ (Prisma)   │   │  (Redis pub/sub fan-out) │      │
       │             │  └────────────┘   └───────────┬──────────────┘      │
       │             │                                │                    │
       │             └────────────────────────────────┼────────────────────┘
       │                                               │
       │                                        ┌──────▼──────┐
       │                                        │    Redis     │◀── shared by
       │                                        │ (single node)│    every API
       │                                        └──────┬──────┘    instance
       │                                               │
       │             ┌─────────────────────────────────┴──────────────────┐
       │             │        Other API process instances (horizontal)     │
       │◀────────────┤  Same gateway/service stack, own in-process session │
       │  (any        │  maps, subscribed to the same Redis channels        │
       │  instance)   └──────────────────────────────────────────────────┘
       │
┌──────▼──────────┐
│ Object Storage   │  ◀── attachments, via presigned URL (client uploads
│ (S3-compatible)  │      directly; API never proxies the bytes)
└──────────────────┘

              ┌────────────────────────────┐
              │   Webhook delivery worker   │  ◀── fed by WebhookEventsService,
              │  (HMAC-signed, retried w/   │      triggered from Messages/
              │   exponential backoff)      │      Conversations/Reactions
              └──────────────┬─────────────┘      services (fire-and-forget)
                             ▼
                   Customer's webhook endpoint
```

### Component-by-component

**Client SDK** (`packages/chat-sdk` for Web; `sdks/flutter/raven_chat`; `packages/react-native-sdk` chat passthrough; `packages/react-sdk/src/chat` hooks on top of the Web SDK). Owns: WebSocket connection lifecycle, exponential-backoff reconnection with jitter, REST fallback for sends while disconnected, an event emitter for incoming frames, and cursor-based history pagination. The Node/Python packages are deliberately server-side/admin SDKs (token minting, conversation/member management, moderation sends) — they don't hold a live socket.

**WebSocket Gateway** (`gateway/chat.gateway.ts`, `connection-registry.service.ts`, `chat-frame.validator.ts`). A NestJS gateway on `@nestjs/platform-ws`'s `WsAdapter` — deliberately **not** Socket.IO, so the client can use the plain browser `WebSocket` API. Verifies the chat token before accepting frames, rate-limits by IP at connect time, runs a server-driven heartbeat (ping every 25s; a socket that doesn't pong is terminated), and validates every inbound frame's size/shape/type before it reaches business logic. Holds two in-process maps per instance: `sessions` (socket → session) and `roomIndex` (conversationId → set of local sockets) — this state is **not** shared across instances; cross-instance awareness comes entirely from the Redis layer below.

**Chat Service layer** (`messages/`, `conversations/`, `reactions/`, `read-state/`, `presence/`, `typing/`, `tokens/`, `rate-limit/`, `attachments/`, `retention/`). Plain NestJS services, each owning one concern, all authorizing through `ConversationsService.authorize()`/`loadForActor()` before touching data — this is the single choke point that enforces per-conversation membership and project isolation. `MessagesService.send()` is the one place both the REST endpoint and the WebSocket `message.send` frame funnel through, so idempotency, rate limiting, and message-limit checks apply identically regardless of transport.

**PostgreSQL** (via Prisma). Source of truth for everything durable: conversations, membership, messages (with a real unique constraint backing client-generated-ID idempotency), reactions, read-state, attachments, and connection records. A message write here is what makes the "stored" ack meaningful — nothing is ever acked back to a sender before it's committed.

**ChatEventsService (Redis pub/sub fan-out).** The layer that makes horizontal scaling work. Publishing is by convention channel `raven:chat:events:{project}:{conversation}`; every gateway instance subscribes only to channels it currently has a local socket interested in (ref-counted, so idle conversations cost nothing) via a dedicated `duplicate()`d Redis connection (subscriber mode is exclusive in ioredis, so it can't share the main client). Delivery from here to a local socket is fire-and-forget — publish failures are logged, not retried, because the message is already durably in Postgres and retrying would risk a confusing double-processing story for a write that already succeeded.

**Redis (single node today).** Backs: pub/sub fan-out, presence (TTL keys + a sorted-set index per conversation), typing (short-TTL keys), rate limiting (fixed-window counters, scoped per subject/action), chat-token revocation (tombstone keys), message-send idempotency fast-path cache, and metrics (per-minute counters). Every one of these call sites is written to **fail open** on a Redis error or timeout (a 2-second command timeout turns a hung Redis into a catchable error rather than a stuck request) — the documented tradeoff is availability over strictness, and it means "Redis is down" degrades chat to slower/dumber rather than broken, except for real-time fan-out itself, which does go dark.

**Object Storage (S3-compatible).** Attachments never transit the API process — the client gets a presigned PUT URL, uploads directly, then calls `complete()` to register the upload. **This is the one place where "implemented" and "working in production" diverge**: per the repo's own documentation audit, the current production deployment has no storage driver actually configured, so this path returns a config error today despite being fully coded.

**Webhook delivery worker.** Decoupled from the request path entirely — `WebhookEventsService.emit()` is called fire-and-forget from within Messages/Conversations/Reactions services (a webhook problem can never fail a chat write), and a separate worker handles HMAC-SHA256 signing, exponential-backoff retry (10/20/40/80/160/320s), and auto-disabling an endpoint after 50 consecutive failures.

### What "horizontal scaling" means concretely today

`docker-compose.scale.yml` and `scripts/chat-load-test.mjs` exist specifically to prove this works: N API replicas, no sticky-session requirement for correctness (a client can land on any instance and still send/receive correctly, because delivery is Redis-mediated, not instance-local), verified by real connect/ack/delivery-latency measurements. The single shared Redis node is the current ceiling — see §3.

---

## 2. Target architecture

The target keeps every component above and adds exactly what's needed to close the P0/P1 gaps from the audit — this is deliberately **not** a rewrite.

```
Client SDK
   ↓ (adds: last_event_id on reconnect, automatic catch-up fetch,
   ↓  block/report/mute calls, mention-aware compose helpers)
WebSocket Gateway
   ↓ (adds: replay-on-reconnect using the outbox below,
   ↓  per-connection delivery cursor tracking)
Chat Service
   ↓ (adds: ModerationService (block/report/mute/ban),
   ↓  MentionsService, SearchService, transactional outbox write
   ↓  alongside the existing Message write)
Redis / PubSub
   ↓ (adds: Redis Sentinel/Cluster for HA + throughput sharding
   ↓  by conversation-hash across multiple nodes)
PostgreSQL
   ↓ (adds: monotonic per-conversation sequence numbers,
   ↓  chat_events outbox table, partitioning of chat_messages
   ↓  by createdAt once retention is enabled, RLS or an
   ↓  auto-scoping Prisma extension for structural tenant isolation)
Object Storage
   ↓ (adds: an actually-configured production driver,
   ↓  content-type allowlist, async malware-scan pipeline)
```

**Why an outbox, specifically:** the cheapest way to turn today's "durable persist + best-effort push" into "durable persist + guaranteed eventual push" without redesigning the transport is to write a small `chat_events` row in the same transaction as the message/reaction/read-state write, publish to Redis as today for the low-latency path, and have a background sweeper (or the gateway itself, on reconnect) fall back to reading unconsumed outbox rows for any connection whose last-acked cursor is behind. This is additive — the Redis pub/sub path stays as the fast path; the outbox is the safety net, not a replacement.

**Why Redis Cluster/Sentinel over "just a bigger Redis":** the current single-node design already fails open safely everywhere except live fan-out, so the priority isn't correctness under Redis failure (that's handled) — it's (a) removing Redis as a single point of failure for presence/rate-limiting/revocation during planned maintenance, and (b) sharding pub/sub channel load across nodes once conversation count and message rate grow past what one node's network/CPU can push. Sentinel gets you failover; Cluster gets you both failover and sharding — see the roadmap for which to reach for at what scale.

**Why Postgres partitioning is conditional:** it's not needed today because `CHAT_RETENTION_DAYS` defaults to keep-forever and most deployments won't have accumulated enough volume yet. It becomes necessary the moment a real customer runs sustained traffic without setting a retention policy — flagging it now so it's not a fire drill later.

---

## 3. Bottleneck summary

| Layer | Today | Bottleneck at scale | Fix |
|---|---|---|---|
| WebSocket gateway | Horizontally scales, load-tested | CPU/connection-count per instance (standard, expected) | Add more instances behind the LB — already supported |
| Redis | Single node | Pub/sub throughput, connection count, single point of failure | Sentinel (HA) → Cluster (HA + sharding) |
| PostgreSQL | Single instance, well-indexed | Write throughput on `chat_messages` at very high send rates; unbounded table growth if retention isn't configured | Read replicas for history reads; partitioning by `createdAt` once retention is active |
| Message ordering | `(createdAt, publicId)` tiebreak | Same-millisecond cross-instance sends can misorder | Per-conversation monotonic sequence |
| Real-time delivery | Fire-and-forget after persist | No guarantee against a dropped Redis publish or a mid-flight gateway crash | Transactional outbox + reconnect replay |
| Object storage | Presign/PUT/confirm flow is correct | Not a scale bottleneck — it's simply unconfigured in production today | Provision the driver (ops task, not an architecture change) |

See `CHAT_ROADMAP.md` §10–11 for concrete architecture recommendations at 10k and 100k+ concurrent connections.
