# Raven Chat — Architecture

## The shape of it

```
                              RAVEN
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
            RTC               Chat               API
              │                 │                 │
       WebRTC / LiveKit     WebSocket            HTTP
              │                 │                 │
              │           Chat Gateway            │
              │                 │                 │
              │           Chat Service            │
              │            ╱         ╲            │
              │           ▼           ▼           │
              │      PostgreSQL     Redis         │
              │       (durable)   (ephemeral)     │
              │           │           │           │
              └───────────┴───────────┴───────────┘
                                │
                          Object Storage
                           (attachments)
```

Three stores, three jobs, and the split is the whole design:

- **PostgreSQL** — everything durable: messages, reactions, read state,
  membership, attachment metadata, webhook queue.
- **Redis** — everything ephemeral and everything cross-instance: presence,
  typing, connection routing, rate limits, and the pub/sub that carries a
  message from the gateway that received it to the gateways that need it.
- **Object storage** — file bytes, reached only through short-lived signed
  URLs. Never Postgres, never the WebSocket.

## Why not put messages in Redis

Redis is where the real-time state lives, and it's tempting to keep messages
there too — it's faster, and the fan-out is already going through it. Raven
doesn't, for one reason: a message has to survive a Redis restart, and
presence doesn't. Conflating those puts the durability of someone's
conversation at the mercy of a cache eviction policy.

The corollary matters just as much: **presence and typing never go into
Postgres.** A user tabbing away and back would otherwise generate two durable
writes per switch, for state that is meaningless five seconds later.

## The message path

```
client
  │  message.send
  ▼
Chat Gateway ──── validate: shape, size, type, permissions
  │
  ▼
Chat Service ──── rate limit (Redis)
  │
  ├──► PostgreSQL       ← the message now exists. Everything after this
  │                       point is best-effort.
  │
  ├──► ack to sender    ← "stored", carrying the canonical id
  │
  ├──► Redis PUBLISH    ← fan-out to every gateway holding a subscriber
  │
  └──► webhook queue    ← a row, not an HTTP call
```

Two properties fall out of that ordering:

**A message is never reported as stored before it is.** The ack comes after
the `INSERT` returns, not before, so a client that got an ack can rely on it.

**Nothing after the write can fail the send.** Redis being down degrades
real-time delivery to "recipients get it from history on their next fetch". A
slow webhook endpoint costs nothing at all, because delivery is a row in a
queue drained by a separate worker.

## Fan-out across instances

A conversation's participants are spread across whichever gateway instances
their load balancer happened to pick. Redis pub/sub is how they find each
other:

```
        Load Balancer
              │
   ┌──────────┼──────────┐
   ▼          ▼          ▼
Gateway 1  Gateway 2  Gateway 3
   │          │          │
   └──────────┼──────────┘
              ▼
          Redis pub/sub
     raven:chat:events:{project}:{conversation}
```

Subscription is demand-driven: a gateway `SUBSCRIBE`s to a conversation only
while it holds at least one socket in it, and unsubscribes when the last one
leaves (ref-counted). A thousand idle conversations cost nothing.

Delivery within an instance is a map lookup against a local
`conversationId → Set<socket>` index — never a scan over all sockets, which is
what keeps a busy conversation from costing O(total connections) per message.

Each gateway holds a **dedicated Redis connection** for subscribing, because
ioredis puts a client into subscriber mode exclusively; reusing the shared
client would break every other Redis call in the process.

## Redis key conventions

Every key below carries a TTL. Nothing in Redis is a permanent record.

| Key | Holds | TTL |
| --- | --- | --- |
| `raven:chat:events:{project}:{conversation}` | pub/sub channel | n/a |
| `raven:presence:{project}:{conversation}:{user}` | presence status | 45s |
| `raven:presence:index:{project}:{conversation}` | sorted set: user → expiry | 180s |
| `raven:typing:{project}:{conversation}:{user}` | typing marker | 7s |
| `raven:typing:index:{project}:{conversation}` | sorted set: user → expiry | 28s |
| `raven:chat:conn:{connectionId}` | gateway, project, user | 45s |
| `raven:chat:user:{project}:{user}` | set of live connection ids | 180s |
| `raven:chat:idem:{project}:{conv}:{sender}:{key}` | message id for a retry | 600s |
| `raven:chat:ratelimit:{scope}:{project}:{subject}` | fixed-window counter | 10–60s |
| `raven:chat:token:revoked:{jti}` | revocation tombstone | token's remaining life |
| `raven:chat:metrics:{project}:{metric}:{bucket}` | per-minute counter | 2h |

The two-key pattern for presence and typing is deliberate: the per-user key
holds the value and expires on its own, while the sorted-set index makes
"list everyone present in this room" one `ZRANGEBYSCORE` instead of a `SCAN`
across the keyspace. Reads prune expired index entries in the same pass, so
the index self-heals whenever anyone looks.

## Expiry as the offline signal

Presence is expiry-driven, not event-driven. A live connection refreshes its
key every 20 seconds, comfortably inside the 45-second TTL. If the process
holding that socket dies without cleaning up — a crash, an OOM kill, a
`docker kill` — the key simply expires and the user goes offline on its own.

That's why a gateway restart is a non-event: the sockets reconnect, and
nothing needs to reconcile stale presence.

## Scaling

Gateways are stateless. They hold sockets and nothing else — every durable
fact is in Postgres, every shared fact is in Redis. So:

- Run as many as you like behind any load balancer. No sticky sessions.
- Kill one and only its sockets are affected; they reconnect elsewhere.
- The `ChatConnection` row records which gateway held each socket, which is
  what you need when one instance in a fleet starts misbehaving.

The pieces that would *not* scale horizontally, and how they're handled: the
webhook delivery worker and the retention sweeper both take a Redis lock, so
only one instance does that work at a time while all of them remain capable
of it.

## Indexes

Every index exists because a specific query needs it:

| Index | Serves |
| --- | --- |
| `chat_messages(conversationId, createdAt, id)` | history pagination — the hot path |
| `chat_messages(senderId, createdAt)` | per-sender filtering, moderation |
| `chat_messages(threadRootId, createdAt)` | thread retrieval as one range scan |
| `chat_messages(conversationId, senderId, clientMessageId)` unique | idempotency |
| `chat_reactions(messageId)` | reactions for a message |
| `chat_reactions(messageId, userId, emoji)` unique | one reaction per user per emoji |
| `chat_read_states(conversationId, userId)` unique | read position lookup |
| `chat_connections(projectId, createdAt)` | dashboard connection list |
| `webhook_deliveries(status, nextAttemptAt)` | the delivery worker's claim query |

Pagination is keyset, not `OFFSET`: `OFFSET 50000` makes Postgres walk and
discard 50 000 rows on every page, while `(createdAt, publicId) < (?, ?)` is
an index seek regardless of depth. It's also stable — messages arriving
mid-scroll can't shift rows across page boundaries.

## Measured limits

These are real numbers from `scripts/chat-load-test.mjs`, not projections.

**Environment.** MacBook (Darwin 25.5, Node 26). Postgres 16, Redis 7,
LiveKit, coturn and MinIO in Docker; the API as a single Node process; the
load generator on the *same machine*, competing for the same CPU.

| | Run A | Run B |
| --- | --- | --- |
| Concurrent connections | 100 | 300 |
| Conversations | 4 | 10 |
| Active senders | 20 | 60 |
| Messages stored | 780 | 4 440 |
| Offered / acked | 35.5 / 35.5 msg/s | 164.4 / 164.4 msg/s |
| Fan-out deliveries | 19 500 (886/s) | 133 200 (4 933/s) |
| Failures | 0 | 0 |
| Send → ack p50 / p95 / p99 | 26 / 42 / 57 ms | 51 / 77 / 98 ms |
| Send → received p50 / p95 / p99 | 27 / 44 / 58 ms | 52 / 78 / 100 ms |
| Mean connect time | 87 ms | 85 ms |

**What this tells you:** a single unoptimised Node process, sharing a laptop
with its own database and its own load generator, sustained 300 concurrent
sockets and ~4 900 fan-out deliveries per second with zero dropped or failed
messages, and end-to-end latency within about 1 ms of storage latency — which
means fan-out is essentially free relative to the database write.

**What this does not tell you:** anything about production capacity. The load
generator and the server contend for the same cores, so these latencies are a
ceiling rather than a projection. Raven has not been tested at thousands of
connections, across regions, or under sustained load for hours. Those numbers
don't exist yet, so they aren't claimed.

To reproduce, raise `CHAT_CONNECTION_RATE_LIMIT` first — the per-IP connection
limiter will (correctly) refuse a load test from a single host otherwise:

```bash
CHAT_CONNECTION_RATE_LIMIT=5000 CHAT_SEND_RATE_LIMIT=5000 pnpm dev
node scripts/chat-load-test.mjs --connections 300 --senders 60 --rate 3 --duration 25 --rooms 10
```

## Failure behaviour

| What fails | What happens |
| --- | --- |
| Redis unavailable | Presence and typing stop working; rate limiters fail open; fan-out stops. Messages still store and still appear in history. Chat degrades, it doesn't break. |
| Postgres unavailable | Sends fail with a clear error. Nothing is silently lost, because nothing was ever acked. |
| A gateway dies | Its sockets reconnect (bounded exponential backoff with jitter). Its Redis keys expire on their own. |
| Client network drops | The SDK reconnects, re-joins its rooms, and refetches what it missed. |
| Token expires mid-session | The socket closes with code `4440`. With `onTokenExpiring` configured, the SDK refreshes and reconnects transparently. |
| A webhook endpoint is down | Retried with exponential backoff, then marked failed. Auto-disabled after 50 consecutive failures. The message path never notices. |
| Object storage unavailable | Attachments fail; text messaging is unaffected. |

## What was deliberately not built

Phase 12 is an MVP architecture that can scale, not the final one. Absent on
purpose:

- **No Kafka.** Redis pub/sub handles fan-out at this scale, and adding a
  broker would mean a third stateful system to operate for no measured gain.
- **No Cassandra/ScyllaDB/DynamoDB.** Postgres handles the message volumes
  this phase targets. The storage layer sits behind a service boundary, so
  swapping it later doesn't change the public SDK.
- **No multi-region.** One region, one Redis. Cross-region fan-out is a
  different problem with different tradeoffs.
- **No message search.** Full-text search over messages needs its own index
  and its own privacy story.
- **No AI moderation.** That belongs to the later AI phase.
