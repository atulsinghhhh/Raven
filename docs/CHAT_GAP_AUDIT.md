# Livqeno Chat — Gap Audit

**Scope:** `apps/api/src/modules/chat` (backend), `packages/chat-sdk` (Web SDK), `packages/react-sdk/src/chat` (React SDK), `packages/server-sdk`/`sdks/python` (server SDKs), `sdks/flutter/raven_chat`, `packages/react-native-sdk` (chat passthrough), `apps/dashboard/.../chat` (dashboard), `docs/chat/*` (docs), plus the chat e2e/unit test suites and load-test tooling.

**Method:** every claim below was checked against source (file:line), not inferred from a type/interface/enum name. Where a doc or type suggested a feature but the runtime code didn't implement it, that's called out explicitly.

**Headline finding:** this is not a bare skeleton. The core send/store/fan-out/read path is real, tested against live Postgres+Redis+WebSocket in `apps/api/test/chat.e2e-spec.ts`, and several things a lot of "Agora Chat clone" projects fake — idempotent sends with a real DB constraint, cursor pagination with no offset drift, HMAC-signed retrying webhooks, fail-open Redis degradation with a documented rationale at every call site, and an actual multi-instance load-test harness (`scripts/chat-load-test.mjs`, `docker-compose.scale.yml`) — are genuinely implemented. The gaps are concentrated in: **durable real-time delivery** (fire-and-forget after persist, no ack/replay), **moderation/safety** (no block/report/ban/mute), **ordering under concurrency**, **cross-language SDK parity**, **observability** (no Prometheus/OTel), and **single-Redis-instance ceiling** at very high scale.

**Product model — confirmed Agora Chat-style, not Discord-style.** This matters for how several findings below should be read. Livqeno Chat, as built, is a **headless messaging API/SDK meant to be embedded into someone else's app** — conversations and membership are created and managed by the *developer's own backend* through the server SDK (API-key/server-actor calls), not by end users browsing and joining things themselves. There is no "server"/"guild" hierarchy, no built-in public-channel directory, and no invite-link system — and that is the correct shape for this product, matching Agora Chat, Stream Chat, and Sendbird, not Discord or Slack. A few items in the table below (public/private channel visibility, self-serve join, invite links) were flagged from a generic "production chat platform" checklist; they're marked **N/A BY DESIGN** rather than gaps, with a note explaining why, and the roadmap has been adjusted accordingly. Everything else in this audit — delivery guarantees, moderation primitives, ordering, SDK parity, observability, scaling — applies identically regardless of which product model is chosen, since those are infrastructure concerns, not community-platform concerns.

---

## 1. Master classification table

| # | Feature | Status | Note |
|---|---|---|---|
| 1 | 1-to-1 messaging | 🟡 PARTIAL | `DIRECT` conversation type exists in schema but has zero usages in service code — no find-or-create-by-two-users helper |
| 2 | Group conversations | ✅ COMPLETE | `ChatMember` + `CHANNEL`/`ROOM` types, add/remove/list all work |
| 3 | Channels | ✅ COMPLETE | `CHANNEL` type fully supported |
| 4 | Public/private channels | ⚪ N/A BY DESIGN | No self-serve discovery/join is correct for the Agora Chat model — the developer's backend decides membership. Livqeno's `ROOM` type (host-controlled join via RTC/live-streaming) is the right analog for "anyone can join if given access," not a public directory |
| 5 | Direct messages | 🟡 PARTIAL | Same as #1 — the type exists, the ergonomics don't |
| 6 | Text messages | ✅ COMPLETE | |
| 7 | Image/file messages | 🟡 PARTIAL | Generic `Attachment` blob works; no image-specific metadata (dimensions, thumbnail) |
| 8 | Audio/video messages | 🔴 MISSING | No duration/waveform/thumbnail fields; treated identically to any other file |
| 9 | Message metadata | ✅ COMPLETE | `Json?` field, size-capped at 4KB |
| 10 | Message IDs | ✅ COMPLETE | Server UUID (internal) + `publicId` |
| 11 | Client-generated IDs | ✅ COMPLETE | `clientMessageId`, real DB unique constraint |
| 12 | Idempotency | ✅ COMPLETE | Redis fast-path + Postgres unique constraint, e2e-tested |
| 13 | Message ordering | 🟡 PARTIAL | `(createdAt, publicId)` tiebreak — publicId is not chronological, so same-millisecond cross-server order is arbitrary |
| 14 | Message persistence | ✅ COMPLETE | Real Postgres write, ack only returned after commit |
| 15 | Message delivery guarantees | ⚠️ NOT PROD READY | Fire-and-forget after persist — see §2 deep-dive |
| 16 | Delivery acknowledgements | 🔴 MISSING | "stored" ack = persistence ack, not a per-recipient delivery ack |
| 17 | Read receipts | ✅ COMPLETE | Position-based, real-time fanout, monotonic marker |
| 18 | Delivered receipts | 🔴 MISSING | Explicitly never persisted — only a live fan-out, "delivered" concept doesn't survive a page reload |
| 19 | Typing indicators | ✅ COMPLETE | TTL-based, not echoed to sender |
| 20 | Online/offline presence | ✅ COMPLETE | Redis TTL + sorted-set index |
| 21 | Last seen | 🔴 MISSING | No persisted last-seen timestamp anywhere |
| 22 | User presence subscriptions | 🟡 PARTIAL | Presence is scoped to a shared conversation; no global "watch this user's presence" API |
| 23 | Message reactions | ✅ COMPLETE | DB-unique per (message,user,emoji), idempotent, real-time fanout |
| 24 | Message replies | ✅ COMPLETE | `replyToMessageId` |
| 25 | Message threads | 🟡 PARTIAL | Flattened filter query, not a Thread aggregate — no persisted reply count |
| 26 | Message editing | 🟡 PARTIAL | Works, but no edit history retained (content overwritten in place) |
| 27 | Message deletion | ✅ COMPLETE | Soft delete, idempotent, tombstoned view |
| 28 | Message recall | 🟡 PARTIAL | Delete achieves the outcome but there's no time-boxed "recall" concept distinct from moderation delete |
| 29 | Pinning | 🔴 MISSING | No field, no endpoint |
| 30 | Mentions | 🔴 MISSING | Zero mention-parsing/storage/notification anywhere |
| 31 | Unread counts | ✅ COMPLETE | Computed live from read-state |
| 32 | Pagination | ✅ COMPLETE | |
| 33 | Cursor-based pagination | ✅ COMPLETE | Opaque `(createdAt, publicId)` cursor, internal IDs never leak |
| 34 | Message history | ✅ COMPLETE | |
| 35 | Search | 🔴 MISSING | No search endpoint, no full-text index anywhere in the module |
| 36 | Attachments | ✅ COMPLETE | Presign → PUT → confirm flow, ownership-checked before attach |
| 37 | Attachment storage | ⚠️ NOT PROD READY | Per the repo's own doc audit: hosted deployment has **no working storage driver** configured |
| 38 | Upload security | 🟡 PARTIAL | Size capped, filename sanitized; no content-type allowlist, no malware scan, no post-upload byte verification |
| 39 | Message size limits | ✅ COMPLETE | Text/metadata/frame all capped and tested |
| 40 | Rate limiting | ⚠️ NOT PROD READY | Real and scoped correctly, but fails open on Redis outage and uses fixed-window (boundary burst) |
| 41 | Spam protection | 🔴 MISSING | Nothing beyond rate limits + exact-duplicate dedup |
| 42 | Abuse prevention | 🔴 MISSING | No block/report/automated detection |
| 43 | Blocking users | 🔴 MISSING | Confirmed absent by exhaustive grep |
| 44 | Reporting users/messages | 🔴 MISSING | Confirmed absent |
| 45 | Moderation | 🟡 PARTIAL | `chat:moderate` scope only covers deleting another member's message |
| 46 | Admin controls | 🟡 PARTIAL | Dashboard is read-only observability; no moderate/ban/delete actions in the UI |
| 47 | Conversation membership | ✅ COMPLETE | |
| 48 | Roles and permissions | 🟡 PARTIAL | 3 roles / 4 scopes defined; `chat:manage` scope is unused/unenforced |
| 49 | Invite/remove members | 🟡 PARTIAL | Add/remove work correctly as server-actor-only operations, which is correct-by-design for this model (the developer's backend decides membership); the only real gap is `chat:manage` scope being unenforced on these calls — not the absence of end-user invite links |
| 50 | Mute members | 🔴 MISSING | |
| 51 | Ban members | 🔴 MISSING | "Remove" is a soft leave; an admin can re-add the same user immediately |
| 52 | Leave conversation | 🟡 PARTIAL | Mechanism exists (`removeMember`) but is scope-gated, not exposed as an end-user self-service action |
| 53 | Conversation deletion | 🔴 MISSING | No delete-conversation endpoint in the inventory |
| 54 | WebSocket lifecycle | ✅ COMPLETE | Auth handshake, heartbeat, clean/TTL disconnect all solid |
| 55 | Connection recovery | 🟡 PARTIAL | Client reconnects with backoff; no session resume — must re-fetch via REST |
| 56 | Reconnection | 🟡 PARTIAL | Transport-level reconnect is well-tested; event replay is not automatic |
| 57 | Multiple devices | 🟡 PARTIAL | Multiple sockets per user supported; fan-out is room-based, not user-multiplexed |
| 58 | Multi-session synchronization | 🟡 PARTIAL | Read-state is shared per-user (good), but no dedicated multi-session sync protocol or test |
| 59 | Offline message synchronization | 🟡 PARTIAL | REST `after`-cursor catch-up works but is client-initiated, not automatic on reconnect |
| 60 | Duplicate message prevention | ✅ COMPLETE | e2e-tested |
| 61 | Event delivery | ⚠️ NOT PROD READY | Same as #15 |
| 62 | Event ordering | 🟡 PARTIAL | Same tiebreak weakness as #13 |
| 63 | Event replay | 🔴 MISSING | No event log; REST history is the only fallback |
| 64 | Event persistence | 🔴 MISSING | Events are transient Redis pub/sub messages, not a persisted log/outbox |
| 65 | Webhooks | ✅ COMPLETE | message/room/participant events wired end-to-end |
| 66 | Webhook signatures | ✅ COMPLETE | HMAC-SHA256, timestamp + 300s tolerance |
| 67 | Webhook retries | ✅ COMPLETE | Exponential backoff (10/20/40/80/160/320s), auto-disable after 50 consecutive failures |
| 68 | Webhook idempotency | ✅ COMPLETE | Stable `evt_...` id in `raven-event-id` header |
| 69 | SDK consistency | 🟡 PARTIAL | Web/Flutter/RN-passthrough aligned; server SDKs intentionally narrower; RN has no chat hooks; Flutter can't upload attachments |
| 70 | API versioning | 🟡 PARTIAL | `v1/...` is a hardcoded path convention, not a framework versioning scheme |
| 71 | Error handling | ✅ COMPLETE | Unified `RavenErrorCode` + `ChatErrorCode`, global exception filter |
| 72 | Error codes | ✅ COMPLETE | |
| 73 | Authentication | ✅ COMPLETE | |
| 74 | Chat tokens | ✅ COMPLETE | HS256, scoped, revocable (fails open on Redis down) |
| 75 | Token expiration | ✅ COMPLETE | Capped TTL, enforced live at heartbeat too |
| 76 | Authorization | ✅ COMPLETE | Per-conversation membership + scope checks, anti-enumeration 404s |
| 77 | Multi-tenancy | 🟡 PARTIAL | Correct everywhere audited, but enforced by convention per service method, not structurally (no RLS/global query filter) |
| 78 | Project isolation | 🟡 PARTIAL | Same caveat as #77 |
| 79 | Database indexes | 🟡 PARTIAL | Strong overall; one missing composite (`conversationId+senderId+createdAt`) for per-sender-in-conversation queries |
| 80 | Database scalability | 🟡 PARTIAL | Single Postgres, no partitioning strategy for `chat_messages` growth |
| 81 | Redis architecture | ⚠️ NOT PROD READY | Single Redis instance, no Sentinel/Cluster — single point of failure for fanout/presence/rate-limit/revocation |
| 82 | Pub/Sub architecture | 🟡 PARTIAL | Demand-driven subscribe (efficient), but no ordering/delivery guarantee, no replay |
| 83 | Horizontal scaling | 🟡 PARTIAL | WS gateway genuinely scales horizontally (proven by load-test harness); bounded by the single Redis node |
| 84 | WebSocket scaling | 🟡 PARTIAL | Same as #83 |
| 85 | Queue/workers | 🟡 PARTIAL | Webhook delivery has a real retry worker; retention runs as an in-process timer, not a distributed job queue |
| 86 | Failure recovery | 🟡 PARTIAL | Degradation behavior is well-documented and consistent; no reconnection replay, no chaos-tested recovery |
| 87 | Observability | ⚠️ NOT PROD READY | Custom Redis counters only — no Prometheus/OTel exporter |
| 88 | Metrics | 🟡 PARTIAL | Counters + averages only, explicitly no percentiles ("would be dishonest") |
| 89 | Logs | 🟡 PARTIAL | NestJS `Logger` used throughout; no structured/correlated log pipeline specific to chat |
| 90 | Distributed tracing | 🔴 MISSING | No OTel spans anywhere in the module |
| 91 | Security (general) | 🟡 PARTIAL | See #92–95 |
| 92 | Encryption in transit | 🟡 PARTIAL | Depends on deployment terminating TLS/WSS; not enforced/verified at the app layer |
| 93 | Encryption at rest | 🟡 PARTIAL | Relies on infra-level disk encryption; no application-level field encryption for message content |
| 94 | Data retention | ✅ COMPLETE | Wired, configurable per-conversation and project-wide, defaults to keep-forever |
| 95 | Privacy | 🔴 MISSING | No PII redaction, no GDPR-style data export, no explicit right-to-erasure flow beyond generic cascade deletes |
| 96 | Backup/recovery | 🔴 MISSING | No chat-specific backup/restore tooling or documented RPO/RTO |
| 97 | Load testing | ✅ COMPLETE | Real `scripts/chat-load-test.mjs` + k6 mixed scenario, results captured in docs |
| 98 | Chaos/failure testing | 🔴 MISSING | No test kills Redis/Postgres/a gateway mid-run |
| 99 | 10k concurrent users | 🟡 PARTIAL | Architecturally plausible and load-test-validated at smaller scale; not demonstrated at exactly 10k |
| 100 | 100k+ concurrent users | 🔴 MISSING | Single Redis node is a hard ceiling; needs sharding/clustering work — see `CHAT_ROADMAP.md` §11 |

---

## 2. Message delivery: at-most-once, at-least-once, or effectively-once?

**Verdict: mixed, by layer — and this is the single most important finding in the audit.**

- **Persistence (client → server → Postgres): effectively-once.** `POST/WS message.send` → `MessagesService.send` writes to Postgres behind a real DB unique constraint on `(conversationId, senderId, clientMessageId)`. A retried send (same client id) returns the original row (`deduplicated: true`) instead of creating a duplicate. This is genuinely idempotent and e2e-tested (`chat.e2e-spec.ts:256-268`).
- **Real-time fan-out (server → connected recipients): at-most-once, fire-and-forget.** Once the DB write succeeds, `ChatEventsService.publish` does a Redis `PUBLISH` and explicitly swallows any failure into a log line — by design, per the code's own comment: turning a Redis blip into a failed send would make the caller retry a write that already succeeded. There is no outbox table, no per-recipient delivery ack, and no retry if the `socket.send()` itself fails or the publish never reaches a subscriber.
- **Catch-up (client → REST history): effectively durable, but pull-based, not push-based.** A client that missed events can always recover them via `GET .../messages?after=<cursor>` — the message is safe in Postgres regardless of what happened to the real-time event. But nothing pushes that catch-up automatically; the client (or SDK) has to know to call it.

**Concretely, what happens when:**

| Scenario | Behavior |
|---|---|
| Network disconnects | Client's socket closes; server detects it either immediately (close frame) or within one heartbeat interval (~25s) via failed ping/pong; `ConnectionRegistryService` cleans up the connection row and presence key. |
| Client reconnects | New WebSocket handshake, new token verification, client must re-`room.join` every conversation it cares about, and must separately call REST history with its last-seen cursor to fetch anything sent while it was away. Nothing is replayed automatically over the socket. |
| Server (gateway) crashes | Any message that had already reached Postgres is safe and recoverable via REST. Any real-time frame that was in flight to that instance's local sockets at the moment of the crash is lost — those clients simply see their socket close and must reconnect + catch up like any other disconnect. Other gateway instances already subscribed to the same conversation are unaffected (their Redis subscription and local sockets are independent). |
| Redis fails | The message write to Postgres still succeeds (it's independent of Redis). But: real-time fan-out silently drops (recipients get nothing until they refetch), presence/typing writes fail silently (users appear offline / no typing indicator), rate limiting **fails open** (limits stop being enforced), token revocation checks **fail open** (a revoked token may still verify until its natural expiry), and metrics writes are dropped. Every one of these fail-open choices is a deliberate, documented tradeoff favoring availability over strictness — but it does mean a Redis outage is also, incidentally, a window where abuse controls are off. |
| Database fails | Message sends fail outright (the write is the source of truth — no offline queue on the server side to buffer writes for later). Reads (history) also fail. This is a hard dependency; there is no read replica or cache fallback for message history in what was found. |
| A message is sent twice | If it's the same `clientMessageId`, the second send is deduped and returns the original message — no duplicate row, e2e-verified. If a client omits `clientMessageId` (or generates a new one each time by mistake), there is no protection — two rows are created. |
| Multiple devices are connected | Each device holds its own WebSocket connection under the same `userId` and must independently join the rooms it cares about; the server does not multiplex delivery across a user's devices — it delivers based on which sockets are subscribed to which conversation's Redis channel. Read-state (last-read cursor) is per-user, not per-device, so a read on one device does correctly reflect as "read" for that user everywhere — but the live "someone read this" event fan-out to *other members* was only tested for a single reader. |

**Bottom line:** Livqeno Chat's delivery model today is best described as **"guaranteed persistence, best-effort real-time push, pull-based recovery."** That is a legitimate and common architecture (Slack, Discord, and Agora Chat itself all lean on a similar pattern), but it is not documented anywhere as an explicit guarantee, there's no delivery SLA, and there's no mechanism (sequence numbers, an outbox, a replay protocol) to upgrade it to true at-least-once real-time delivery without a REST round-trip. See `CHAT_ROADMAP.md` Phase 2 for the concrete path to close this gap (durable outbox + resumable WebSocket sessions with a `last_event_id`).

---

## 3. WebSocket architecture: can it horizontally scale?

**Yes, today, with a caveat.** The pipeline is:

```
Client → WebSocket Gateway (raw `ws` via NestJS WsAdapter, per-instance in-memory session/room maps)
       → Redis PUBLISH on a per-conversation channel (ChatEventsService)
       → every gateway instance holding ≥1 local socket in that conversation SUBSCRIBEs (ref-counted, demand-driven)
       → each instance delivers to its own local sockets only
       → (separately, before fan-out) MessagesService writes the row to PostgreSQL
```

This is a genuine, working horizontal-scale design — **not** the standard Socket.IO Redis adapter (the project deliberately avoids Socket.IO to keep the native browser `WebSocket` API on the client), but a hand-rolled equivalent with the same effect: any gateway instance can serve any client, and a message sent through instance 1 correctly reaches a recipient parked on instance 3. This is validated by real tooling — `docker-compose.scale.yml` exists specifically to run N API replicas, and `scripts/chat-load-test.mjs` measures connect/ack/delivery latency against a scaled deployment, with results captured in the (legacy) architecture doc.

**The bottleneck: a single Redis instance.** `RedisService` connects to one Redis URL with no Cluster/Sentinel configuration found anywhere in `apps/api/src/shared/config`. Every gateway instance opens its own dedicated `duplicate()` subscriber connection (required because ioredis subscriber mode is exclusive per connection) plus uses the shared client for publish/rate-limit/presence/idempotency/revocation. At high instance counts and high conversation fan-out, this single Redis node becomes:
- the ceiling on total pub/sub throughput,
- a single point of failure for real-time delivery, presence, typing, rate limiting, and idempotency caching (all fail open, so the *failure mode* is graceful, but the *capacity* is not distributed),
- a connection-count concern (N gateway instances × 1 dedicated subscriber connection each, plus the shared client pool).

There is no sharding of conversations across multiple Redis nodes, and no read/write split. This is the correct next investment for scaling past current levels — see `CHAT_ARCHITECTURE.md` and `CHAT_ROADMAP.md` Phase 8.

---

## 4. Database audit

Schema location: `apps/api/prisma/schema.prisma` (chat models span roughly lines 510–770).

**Models:** `Conversation`, `ChatMember`, `Message`, `Reaction`, `ReadState`, `Attachment`, `ChatConnection`.

**Indexes present and correctly matched to query patterns:**
- `Conversation`: `@@unique([projectId, environment, name])`, `@@index([projectId, createdAt])`
- `ChatMember`: `@@unique([conversationId, userId])`, `@@index([projectId, userId])`
- `Message`: `@@unique([conversationId, senderId, clientMessageId])` (idempotency), `@@index([conversationId, createdAt, id])` (backs the main pagination scan), `@@index([senderId, createdAt])`, `@@index([threadRootId, createdAt])` (backs `listThread`)
- `Reaction`: `@@unique([messageId, userId, emoji])`, `@@index([messageId])`
- `ReadState`: `@@unique([conversationId, userId])`, `@@index([lastReadMessageId])`
- `Attachment`: `@@index([conversationId])`, `@@index([messageId])`

**Recommended additions:**
1. `@@index([conversationId, senderId, createdAt])` on `Message` — `list()` supports filtering by `dto.senderId` within a conversation, and today that query can only lean on `[conversationId, createdAt, id]` plus a filter, not a fully covering composite.
2. A partial index or separate archival strategy once `chat_messages` grows large per conversation — see partitioning note below.

**Partitioning strategy recommendation:** `chat_messages` is the only table here likely to reach a size where partitioning matters. Recommend **range partitioning by `createdAt` (monthly)** once retention is actually enabled in production (today `CHAT_RETENTION_DAYS` defaults to `0`, i.e. keep forever — meaning if this ships to a real customer with real traffic, the table grows unbounded). Partitioning by `createdAt` pairs naturally with the existing retention sweeper (`chat-retention.service.ts`), which could drop whole partitions instead of batched `DELETE`s once volume justifies it. Do **not** partition by `conversationId` — conversation sizes are too skewed (some will be huge, most tiny) for that to balance well.

**Multi-tenancy:** every chat-relevant model carries `projectId`, and every read path audited (`resolve()`, `loadForActor()` in messages/attachments services) checks it before returning data, using a generic "not found" for cross-project access rather than a 403 (deliberate anti-enumeration design). This is correct in every path we read, but it is enforced **by convention in each service method**, not by a database-level policy (no Postgres RLS on these tables, no Prisma middleware that auto-injects a `projectId` filter). That means it is currently safe because every existing query was hand-written correctly, not because it's structurally impossible to get wrong in a future change. Given the project's own memory notes that Supabase RLS is already in place for *other* tables, extending RLS (or a Prisma extension that auto-scopes) to the chat tables would remove an entire class of future regression risk cheaply.

---

## 5. SDK experience — consistency matrix

| Concept | Web | React | Server (Node) | Python | Flutter | React Native |
|---|---|---|---|---|---|---|
| Send message | ✅ | ✅ (hook) | ✅ (incl. system msgs) | ✅ | ✅ | ✅ (raw client) |
| Edit message | ✅ | ✅ (via client) | 🔴 | 🔴 | ✅ | ✅ (raw client) |
| Delete message | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| History / pagination | ✅ | ✅ (hook) | ✅ | ✅ | ✅ | ✅ |
| Reactions | ✅ | ✅ (hook) | 🔴 | 🔴 | ✅ | ✅ (raw client) |
| Typing indicators | ✅ | ✅ (hook) | 🔴 | 🔴 | ✅ | ✅ (no hook) |
| Read receipts | ✅ | ✅ (hook) | 🔴 | 🔴 | ✅ | ✅ (no hook) |
| Presence | ✅ | ✅ (hook) | 🔴 | 🔴 | ✅ | ✅ (no hook) |
| Attachments | ✅ (upload+download) | ✅ (via client) | 🔴 | 🔴 | 🟡 (receive-only, no upload) | ✅ (raw client) |
| Real-time subscription | ✅ | ✅ | N/A | N/A | ✅ | ✅ (no hooks) |
| Reconnect w/ backoff | ✅ tested | inherited | N/A (HTTP retry) | N/A (HTTP retry) | ✅ same algorithm | inherited |
| Offline queueing | 🔴 | inherited | N/A | N/A | 🔴 | inherited |
| Multi-device API | 🔴 everywhere | — | — | — | — | — |
| React-idiomatic hooks | N/A | ✅ full set | N/A | N/A | N/A | 🔴 imperative only |

The Node and Python server SDKs' narrowness is **intentional** (they're control-plane/admin SDKs, not realtime clients) and not a defect. The real gaps are: **Flutter cannot upload attachments** (can only deserialize/receive them), **React Native has the full `ChatClient` surface available via `raven.chat.*` but no dedicated hooks**, so RN developers must write imperative event-listener code where React web developers get `useTyping`/`usePresence`/`useReadReceipts`, and **no SDK anywhere exposes a multi-device concept** (device ID, per-device session list, remote logout).

Wire-protocol naming is consistently aligned across the raw-WebSocket SDKs (Web, Flutter, RN-via-passthrough) — frame types like `message.send`, `typing.start`, `room.join` match the server's `ChatClientFrame` enum, which is good evidence this was designed cross-language from the start rather than bolted on per-platform.

---

## 6. Developer experience walkthrough

| Step | Experience today |
|---|---|
| 1. Create a Livqeno project | Outside chat scope — handled by the platform's project/onboarding flow. |
| 2. Obtain credentials | API key issued per project (via `ApiKeysModule`); chat additionally requires minting a short-lived chat token server-side. |
| 3. Authenticate a user | `POST v1/chat/tokens` (server-actor only) → returns an HS256 JWT-like token scoped to a user, project, and optionally specific conversations. No client-side "login" call — the token itself carries identity. |
| 4. Connect to Chat | SDK opens a WebSocket with the token as a query param (browsers can't set headers on the WS handshake) and awaits the `CONNECTED` frame. Straightforward, one call in every SDK reviewed. |
| 5. Create/join a conversation | Conversation creation and membership are server-actor-only, correctly matching the Agora Chat model (the developer's backend decides who's in a conversation; there's no end-user self-join or public directory, and there shouldn't be for this product). The one real friction point: for a 1:1 DM specifically, there's no find-or-create helper, so a developer must build their own "does a DIRECT conversation between these two users already exist" logic on top of raw `createConversation`/`addMember`. |
| 6. Send a message | One call (`sendMessage`/`send`/`send_message`), consistent naming and required params across SDKs, with idempotency built in if a `clientMessageId` is supplied. |
| 7. Receive messages | Event subscription (`on('message', ...)` or hook) in every client SDK; consistent. |
| 8. Handle reconnection | The SDK does this automatically (backoff + rejoin rooms) in Web/Flutter/RN; the developer's own responsibility is only to re-fetch missed history via the cursor — **this step is not automatic anywhere** and isn't obviously surfaced (a developer has to know to listen for a `reconnected` event and manually call `messages.list({ after: cursor })`). |
| 9. Retrieve history | One call, cursor-based, consistent across SDKs. |
| 10. Subscribe to events | Consistent event-emitter pattern (Web/Flutter) or hooks (React); React Native has the capability but no hook sugar. |

**Unnecessary steps / friction identified:**
- No find-or-create helper for 1:1 DMs — every "start chatting with this other user" flow needs custom existence-checking logic on top of raw `createConversation`/`addMember` that the platform could provide as one convenience call, without changing who's authorized to create it (still backend-driven, same as Agora Chat's own single-chat convenience methods).
- Reconnection is well-automated at the transport level but silently *incomplete* at the application level (no automatic catch-up fetch), which is exactly the kind of gap that produces "messages sometimes go missing" bug reports in production.
- Two idempotency systems exist in the codebase (a generic header-based one used elsewhere in the API, and chat's own field-based one) — not a developer-facing problem for chat specifically, but worth consolidating so future chat endpoints don't have to choose between two patterns.

---

## 7. Detailed gap write-ups

Grouped by theme. Each covers: current implementation, missing functionality, why it matters, exact files, DB/API/SDK/architecture changes required, tests required, complexity, priority.

### 7.1 Real-time delivery durability (#15, #16, #18, #55, #56, #59, #61–64)

- **Current implementation:** Message persists to Postgres first (source of truth), then a fire-and-forget Redis `PUBLISH` fans it out to whichever gateway instances currently hold a subscribed socket in that conversation. No ack from the recipient socket back to the server; no record that a "message event" was ever emitted (only the resulting row exists). Reconnection is transport-only — clients rejoin rooms but don't automatically request missed events.
- **Missing functionality:** (a) an outbox/event log that records "this message needs to be delivered to these N members" with per-member delivery state; (b) a resumable WebSocket protocol — e.g., a `last_event_id`/cursor sent by the client on `CONNECTED`, with the server replaying anything newer for the conversations it rejoins; (c) delivered-receipt persistence; (d) automatic catch-up fetch triggered by the SDK itself on reconnect, not left to the developer.
- **Why it matters:** this is the single biggest gap between "functional prototype" and "production messaging platform." Every competitor (Agora Chat, Stream, Sendbird) makes an explicit, documented delivery guarantee and provides session resumption; today Livqeno's is implicit and depends on developers correctly wiring a manual REST catch-up.
- **Exact files:** `apps/api/src/modules/chat/realtime/chat-events.service.ts`, `gateway/chat.gateway.ts`, `messages/messages.service.ts`; client-side in `packages/chat-sdk/src/internal/socket-transport.ts` and equivalents in Flutter/RN.
- **Database changes:** new `ChatDeliveryReceipt` (or extend `ChatConnection`) table tracking per-connection last-delivered event id/timestamp; optionally an append-only `chat_events` outbox table if full replay (not just "there's more, go fetch it") is desired.
- **API changes:** WebSocket `CONNECTED`/`room.join` frames gain an optional `since`/`last_event_id` param; server replies with a `catch_up_required` marker or performs the replay itself for a bounded window.
- **SDK changes:** every SDK's reconnect handler must automatically trigger the catch-up fetch (already has the cursor infrastructure — `messages.list({ after })` — this is wiring, not new plumbing).
- **Architecture changes:** introduce an outbox pattern between the Postgres write and the Redis publish (transactional outbox, or at minimum a durable per-conversation event log with a bounded retention window for replay).
- **Tests required:** integration test that kills the gateway mid-fan-out and asserts the client recovers all messages on reconnect; a chaos test that drops Redis mid-send and asserts no message is permanently lost from the recipient's perspective (only delayed).
- **Complexity:** XL. **Priority:** P0.

### 7.2 Message ordering under concurrency (#13, #62)

- **Current implementation:** `ORDER BY createdAt, publicId` — `publicId` is a random/UUID-derived string, not monotonic.
- **Missing functionality:** a true monotonic per-conversation sequence number (or a globally sortable ID scheme like ULID/Snowflake) so same-millisecond messages from different origins order deterministically and meaningfully.
- **Why it matters:** at any real concurrency (two users typing at once, or multiple gateway instances under load), same-millisecond messages can display in an order that doesn't match server-receipt order, which is directly visible to end users as "messages out of order."
- **Exact files:** `apps/api/src/modules/chat/messages/messages.service.ts`, `messages/cursor.util.ts`, schema `Message` model.
- **Database changes:** add a per-conversation monotonic `sequence` column (e.g., backed by a Postgres sequence scoped per conversation, or switch `publicId` generation to ULID which is lexicographically sortable by creation time).
- **API changes:** cursor encoding updates to use `(createdAt, sequence)` instead of `(createdAt, publicId)`.
- **SDK changes:** none if the cursor stays opaque (it is, today) — just needs a migration for existing cursors in flight.
- **Tests required:** concurrent-send test asserting stable, meaningful ordering under real parallel writes from multiple simulated origins.
- **Complexity:** M. **Priority:** P1.

### 7.3 Moderation & safety: blocking, reporting, mute, ban (#41–46, #50, #51)

- **Current implementation:** `chat:moderate` scope lets a moderator/admin delete another member's message. `removeMember` exists but is a soft "leave," immediately re-addable. Nothing else.
- **Missing functionality:** user-to-user blocking, message/user reporting (with a queue an admin can review), muting (silence a member without removing them), banning (prevent re-join), and any spam heuristic beyond rate limits and exact-duplicate dedup.
- **Why it matters:** any public-facing chat product without these will accumulate abuse reports immediately upon real usage; this is table-stakes for a "production-grade" claim, not a nice-to-have.
- **Exact files:** new modules needed under `apps/api/src/modules/chat/` (e.g. `moderation/`, `blocks/`), extending `chat-permissions.ts`, `conversations.service.ts`.
- **Database changes:** new tables — `ChatBlock` (blocker/blocked pair), `ChatReport` (reporter, target message/user, reason, status), `ChatMemberMute` (or a `mutedUntil` column on `ChatMember`), a `banned` flag or separate `ChatBan` table keyed by (conversationId, userId) checked in `addMember`.
- **API changes:** `POST .../block`, `DELETE .../block`, `POST .../report`, `POST .../members/:id/mute`, `POST .../members/:id/ban`, dashboard endpoints to review reports.
- **SDK changes:** new methods across all client SDKs (`blockUser`, `reportMessage`, etc.) — this is where the current cross-SDK consistency discipline should be applied from day one.
- **Architecture changes:** none beyond the new tables/services; fits the existing pattern.
- **Tests required:** e2e coverage for block-prevents-DM, mute-prevents-send-but-allows-read, ban-prevents-re-join.
- **Complexity:** L. **Priority:** P0 for block/report (trust & safety baseline), P1 for mute/ban.

### 7.4 Mentions, pins, search (#29, #30, #35)

- **Current implementation:** none of the three exist. `metadata: Json?` could carry mentions as a developer convention today but there's no first-class parsing, storage, or notification.
- **Missing functionality:** @mention extraction + a way to query "messages that mention me" (feeds unread/notification logic); message pinning (field + list-pinned endpoint); any search (no full-text index, no external search service integration).
- **Why it matters:** mentions and search are consistently in the "top requested" bucket for any real chat product; their absence is a clear differentiator gap versus Agora Chat/Stream/Sendbird.
- **Exact files:** `messages/messages.service.ts`, `messages/message.serializer.ts`, new `mentions/` and `search/` concerns.
- **Database changes:** `MessageMention` join table (messageId, mentionedUserId) populated at send time by parsing `content`; `Message.pinnedAt`/`pinnedBy` columns or a small `ConversationPin` table; for search, either Postgres full-text (`tsvector` column + GIN index on `content`) for a first pass, or an external index (OpenSearch/Meilisearch) if cross-conversation relevance search is required later.
- **API changes:** `GET .../messages?mentioning=me`, `POST/DELETE .../messages/:id/pin`, `GET .../search?q=...`.
- **SDK changes:** mention-aware compose helpers (nice-to-have, not required for v1), pin/unpin methods, search method — across all SDKs.
- **Tests required:** mention parsing correctness (unicode usernames, edge cases), pin/unpin idempotency, search relevance/pagination.
- **Complexity:** mentions M, pins S, search L (Postgres FTS) to XL (external search service). **Priority:** P1 (mentions), P2 (pins), P2 (search — P1 if the product pitch depends on it).

### 7.5 Attachment production-readiness (#37, #38)

- **Current implementation:** presign → PUT → confirm flow works and is well-designed (filename sanitization, size cap, ownership check before attach). The confirm step deliberately trusts the client rather than doing a storage HEAD check.
- **Missing functionality:** a configured storage driver in the production deployment (per the repo's own documentation audit, uploads currently fail with `RAVEN_NOT_CONFIGURED` in that environment); a content-type allowlist; malware/virus scanning; server-side verification that uploaded bytes match the declared size/type.
- **Why it matters:** without a working storage driver, attachments are a demoed-but-non-functional feature in production today — this is the single highest-severity "looks done, isn't" finding in the whole audit. Without an allowlist/scan, the upload path is an open door for hosting arbitrary/malicious files behind a trusted domain.
- **Exact files:** `apps/api/src/modules/chat/attachments/attachments.service.ts`, `s3-presign.util.ts`, deployment/env configuration (storage driver selection).
- **Database changes:** none required for the storage-driver fix; a `scanStatus` column on `Attachment` if virus scanning is added (pending/clean/flagged).
- **API changes:** none for the storage fix (config-only); scan status surfaced in attachment responses if added.
- **Architecture changes:** wire an actual S3-compatible bucket (or Azure Blob, per the doc's own gap note) in the production deployment; optionally an async scan step (queue → scan worker → update `scanStatus`) before an attachment is considered "safe to serve."
- **Tests required:** an actual upload-to-real-bucket smoke test in CI against a test bucket/minio, not just presign-URL-shape unit tests.
- **Complexity:** storage-driver fix is S (config/ops, not code); allowlist is S; scanning is M–L (needs an async pipeline). **Priority:** P0 for the storage driver (it's currently broken in production), P1 for allowlist, P2 for scanning.

### 7.6 Observability (#87–90)

- **Current implementation:** `ChatMetricsService` writes fire-and-forget per-minute counters and sum/count latency pairs to Redis, read back by the dashboard. No Prometheus client, no OpenTelemetry SDK, no distributed tracing anywhere in the module.
- **Missing functionality:** a real metrics exporter (Prometheus `/metrics` or OTel metrics) with actual histograms/percentiles; distributed tracing spans across the send → persist → publish → deliver path so a slow message can be diagnosed across process boundaries; structured, correlated logs (e.g., a `traceId` threaded through gateway → service → webhook worker).
- **Why it matters:** at production scale, "average latency in a Redis counter, read back for a dashboard" is not sufficient to diagnose a real incident (a P99 spike is invisible in an average). This is standard operational hygiene for any product claiming to run at scale.
- **Exact files:** `apps/api/src/modules/chat/metrics/chat-metrics.service.ts`, new instrumentation across `gateway/`, `messages/`, `realtime/`.
- **Architecture changes:** add an OTel SDK integration (traces + metrics), export to whatever backend the platform standardizes on (the existing `apps/api/src/modules/observability` module — not read in this audit — may already provide scaffolding to hook into).
- **Tests required:** none functionally required, but should validate exporter wiring doesn't regress request latency.
- **Complexity:** M (assuming the platform already has an observability module to hook into) to L (if building from scratch). **Priority:** P1 (needed before real production scale, not needed for MVP).

### 7.7 API versioning, roles/manage scope, DM ergonomics (#1, #5, #48, #49, #52, #53, #70, #77, #78)

- **Current implementation:** `v1/` is a hardcoded string in every controller path; no `enableVersioning()`/negotiation. `chat:manage` scope is defined but nothing checks for it. Add/remove-member and conversation-create are all server-actor-only — correct for the Agora Chat model, not a gap. There's no conversation-delete endpoint at all. Multi-tenancy is correct but convention-enforced, not structural. There's no find-or-create helper for 1:1 `DIRECT` conversations.
- **Missing functionality:** a real versioning strategy (even just formalizing the URI-prefix approach with Nest's built-in versioning, so a v2 doesn't require ad hoc parallel controllers); enforcement of `chat:manage` on membership-mutating operations; a delete-conversation endpoint; structural multi-tenant enforcement (RLS or a Prisma extension); a `findOrCreateDirect(userA, userB)`-style server-SDK convenience method (still server-actor-only — this is ergonomics, not an end-user self-join feature).
- **Why it matters:** these are lower-severity than the delivery/moderation gaps but represent real technical debt that gets more expensive to fix the longer the API surface grows.
- **Exact files:** `apps/api/src/modules/chat/controllers/*.ts`, `chat-permissions.ts`, `conversations/conversations.service.ts`, `main.ts`.
- **Database changes:** none for versioning/scopes; none for delete-conversation (soft-delete flag recommended, mirroring message soft-delete); none for the DM helper (it's a query/upsert over existing schema).
- **API changes:** `DELETE v1/chat/conversations/:room`; `POST v1/chat/conversations/direct` (server-actor-only, find-or-create by two user IDs); enforce `chat:manage` in `addMember`/`removeMember`.
- **Architecture changes:** adopt Postgres RLS for chat tables (the project already has RLS elsewhere per prior work) or a Prisma client extension that auto-injects `projectId` into every chat-table query.
- **Tests required:** RLS/extension regression test that a query missing an explicit `projectId` filter still can't cross tenants; delete-conversation cascade test; DM find-or-create idempotency test (calling it twice for the same pair returns the same conversation).
- **Complexity:** S–M each. **Priority:** P2, except structural multi-tenancy enforcement which is P1 (cheap insurance against a class of future bugs).

---

## 8. What's already genuinely solid (don't re-litigate these)

To avoid the roadmap re-doing work that's already correct: idempotent sends, cursor pagination, reactions, read-state, typing, presence, webhooks (signature/retry/idempotency), chat token auth/revocation, per-conversation authorization with anti-enumeration, rate limiting scoping, retention sweeps, and the e2e/load-test tooling are all real, tested, and reasonably well-architected. The roadmap in `CHAT_ROADMAP.md` is written to build on top of these, not replace them.
