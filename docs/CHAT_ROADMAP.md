# Raven Chat — Roadmap

Companion to `CHAT_GAP_AUDIT.md` (feature-by-feature findings) and `CHAT_ARCHITECTURE.md` (current + target architecture). Phases are ordered so each is buildable on top of what's already real — see the audit's §8 for what not to redo.

---

## Phase 1 — Core messaging
*Already substantially complete.* Send/edit/delete, cursor pagination, reactions, replies/threads-as-filter, read-state, attachments (pending storage-driver fix). Remaining work: fix the production attachment storage driver (P0, S — it's a config/ops gap, not code), add the missing `[conversationId, senderId, createdAt]` index (P2, S).

## Phase 2 — Reliability
The highest-priority phase. Transactional outbox alongside the message/reaction/read-state write; per-conversation monotonic sequence number to fix same-millisecond ordering; WebSocket reconnect protocol gains a `last_event_id`/cursor so the client — not the developer — automatically catches up; delivered-receipt persistence. This closes the biggest gap in the whole audit (§2 of `CHAT_GAP_AUDIT.md`).

## Phase 3 — Presence/events
Persist "last seen" (currently entirely absent); add a user-level presence subscription API (today presence is scoped to a shared conversation only); extend read-receipt fanout testing to multi-reader/multi-session races; formalize event ordering guarantees once Phase 2's sequence number lands.

## Phase 4 — Groups/channels
A `findOrCreateDirect(userA, userB)` server-SDK convenience method for 1:1 DMs (the `DIRECT` type exists in schema but has no ergonomics today — still server-actor-only, matching Agora Chat's own single-chat convenience methods, not an end-user self-join feature); enforce the currently-unused `chat:manage` scope on membership mutations; add conversation deletion (soft-delete, mirroring message soft-delete). No self-serve public-channel discovery/join or invite-link system is planned — that's a Discord/Slack-workspace pattern, not part of this product's model; Raven's `ROOM` type (host-controlled join via the RTC/live-streaming plane) already covers the "give someone access to join" use case this product actually needs.

## Phase 5 — Attachments/media
Content-type allowlist; async malware-scan pipeline before an attachment is servable; type-specific metadata for images (dimensions, thumbnail) and audio/video (duration, waveform/poster) instead of treating every attachment as an opaque blob; Flutter SDK gains attachment upload (currently receive-only).

## Phase 6 — Moderation
User blocking, message/user reporting with an admin review queue, mute (silence without removing), ban (prevent re-join — today's "remove" is an immediately-re-addable soft leave), and dashboard UI to act on reports/moderate messages (today the dashboard is read-only observability). This is trust-and-safety table stakes, not a nice-to-have, before any public-facing launch.

## Phase 7 — Analytics/observability
Replace Redis-counter-only metrics with a real Prometheus/OTel exporter (percentiles, not just averages); add distributed tracing across the send → persist → publish → deliver path; structured/correlated logging. Needed before production scale, not needed for MVP.

## Phase 8 — Horizontal scaling
Redis Sentinel (HA) then Redis Cluster (HA + channel sharding) to remove the single Redis node as both a SPOF and a throughput ceiling; Postgres read replicas for history reads; partition `chat_messages` by `createdAt` once a retention policy is actually enabled in production (today it defaults to keep-forever).

## Phase 9 — Enterprise features
Mentions (@user parsing/storage/notification), message pinning, search (Postgres full-text as a first pass, external search service if cross-conversation relevance search is a product requirement), multi-device session management (device list, remote logout — currently absent across every SDK), data export / right-to-erasure flows for privacy compliance, structural multi-tenancy enforcement (RLS or an auto-scoping Prisma extension, upgrading today's correct-but-convention-based isolation), API versioning as a first-class mechanism instead of a hardcoded `v1/` string.

---

## 1. Top 20 missing Chat features
1. Delivery acknowledgement / true at-least-once real-time delivery
2. Automatic reconnect catch-up (client-driven today, should be automatic)
3. Delivered-receipt persistence
4. Last-seen persistence
5. User blocking
6. Message/user reporting
7. Mute members
8. Ban members
9. Mentions (@user)
10. Message pinning
11. Search
12. Chat Room type parity for large-scale broadcast/live-chat use cases (host-controlled join, no persistent membership) — extending the existing `ROOM` type's RTC/live-streaming integration
13. 1:1 DM find-or-create helper (server-SDK convenience, still backend-driven)
14. Conversation deletion endpoint
15. Multi-device session management (device list, remote logout)
16. Content-type allowlist + malware scanning for attachments
17. Working production attachment storage driver
18. Prometheus/OTel metrics with real percentiles
19. Distributed tracing
20. Per-conversation monotonic sequence number for true ordering

## 2. Top 10 reliability problems
1. Fire-and-forget real-time fan-out with no ack/retry/outbox
2. No event replay on reconnect (client must know to manually refetch)
3. Single Redis instance is a SPOF for fan-out, presence, rate limiting, and token revocation
4. Message ordering tiebreak (`publicId`) is not chronological
5. No chaos/failure-injection testing anywhere in the suite
6. Retention sweep runs as an in-process timer, not a distributed job queue (single point of scheduling failure per instance, though a Redis lock does prevent duplicate runs)
7. No read replica for Postgres — history reads and writes share the same instance
8. No automated test for gateway-crash-mid-delivery recovery
9. No automated test for concurrent-write ordering correctness
10. Rate limiting and token revocation both fail open on Redis outage (safe by design, but means abuse controls silently go dark during an incident)

## 3. Top 10 security problems
1. No content-type allowlist on attachment uploads
2. No malware/virus scanning on attachments
3. No server-side verification that uploaded bytes match declared size/type (client is trusted post-upload)
4. No blocking/reporting — no user-level abuse mitigation at all
5. Multi-tenancy is convention-enforced (correct today, structurally fragile — one missed check in a future change leaks cross-project data)
6. No distinct spam/abuse heuristic beyond rate limits and exact-duplicate dedup
7. No encryption-at-rest guarantee at the application layer for message content (relies entirely on infra-level disk encryption)
8. No verification that transport-layer TLS/WSS is enforced by the app itself (deployment-dependent, unverified in this audit)
9. No privacy/data-export/right-to-erasure flow beyond generic cascade deletes
10. `chat:manage` scope is defined but unenforced — membership mutation is effectively unscoped beyond server-actor status

## 4. Top 10 scalability problems
1. Single Redis node — no Cluster/Sentinel
2. No Postgres read replicas
3. No partitioning strategy for `chat_messages` (fine today, unbounded-growth risk once retention isn't configured)
4. No sharding of pub/sub channels across multiple Redis nodes
5. Metrics/observability can't currently diagnose a P99 latency spike (average-only)
6. No demonstrated validation at 10k or 100k+ concurrent connections (load-tested at smaller scale only)
7. Retention sweep is a single in-process timer per instance, not designed for very large table volumes (batched deletes, not partition drops)
8. No connection-count ceiling analysis for the dedicated Redis subscriber-per-instance pattern at very high instance counts
9. No caching layer in front of Postgres for hot conversation history reads
10. No backpressure/queueing for webhook delivery under a burst of chat events (worker retries individually, no batching)

## 5. Top 10 database problems
1. Missing composite index `[conversationId, senderId, createdAt]` on `Message`
2. No per-conversation monotonic sequence number (ordering relies on a non-chronological tiebreak)
3. No partitioning strategy for `chat_messages`
4. No Postgres RLS on chat tables (isolation is correct but convention-enforced, not structural)
5. `CHAT_RETENTION_DAYS` defaults to `0` (keep forever) — a real deployment with real traffic and this default will grow `chat_messages` unbounded
6. No read replicas — all reads and writes share one instance
7. No `chat_events` outbox table — real-time delivery has no durable, replayable log
8. No edit-history table (message edits overwrite content in place)
9. No dedicated Thread aggregate — reply counts are computed on demand, not stored
10. No `MessageMention`/pin/ban/mute/report tables yet (Phase 6/9 work)

## 6. Top 10 SDK/API problems
1. Flutter SDK cannot upload attachments (receive-only)
2. React Native SDK has the full chat surface via `raven.chat.*` but no dedicated hooks (imperative-only, unlike React web)
3. No SDK anywhere exposes a multi-device concept
4. Reconnect-then-catch-up is not automatic in any SDK — developer must wire the refetch themselves
5. No `findOrCreateDirect`-style 1:1 DM convenience helper across any server SDK
6. Reconnect logic re-joins rooms but has no visible SDK-level contract documenting what "at-least-once" means, if anything, for real-time events
7. API versioning is a hardcoded `v1/` string, not a framework-level scheme — a v2 requires parallel controllers
8. Two parallel idempotency mechanisms exist in the codebase (generic header-based, chat's own field-based) — not wrong, but inconsistent for future endpoint authors
9. Node/Python server SDKs lack edit/reactions/typing/presence/attachments — intentional scope, but undocumented as such anywhere a developer would see it before hitting a `MISSING` method
10. No block/report/mute/ban methods in any SDK (blocked on Phase 6 backend work)

## 7. Exact implementation order
1. Fix production attachment storage driver (P0, S — currently broken, not a design gap)
2. Transactional outbox + reconnect replay (Phase 2 — the single biggest reliability gap)
3. Per-conversation monotonic sequence number (Phase 2 — cheap, fixes ordering)
4. Delivered-receipt persistence (Phase 2)
5. User blocking + reporting + admin review queue (Phase 6 — trust & safety baseline before any public launch)
6. Mute + ban (Phase 6)
7. Content-type allowlist + malware scanning for attachments (Phase 5)
8. Structural multi-tenancy enforcement — RLS or Prisma extension (cheap insurance, do before the API surface grows further)
9. DM find-or-create convenience helper (Phase 4 — developer-experience unlock, still backend-driven)
10. Prometheus/OTel metrics + tracing (Phase 7 — needed before real production scale)
11. Redis Sentinel → Cluster (Phase 8 — do once traffic actually approaches the single-node ceiling, not preemptively)
12. Mentions, pinning, search (Phase 9 — differentiation features, not blocking)
13. Multi-device session management, data export/erasure, API versioning formalization (Phase 9 — enterprise-readiness)

## 8. What should NOT be implemented yet
- **Any Discord/Slack-style community layer** — a "server"/"guild" hierarchy, public-channel directory, invite links, or end-user self-join. This isn't a "not yet," it's out of scope for the product this is: a headless messaging API/SDK the developer's own app embeds, where the developer's backend is always the authority on membership (matching Agora Chat, Stream, Sendbird). Building this would be a different product, not a chat-service feature.
- **Redis Cluster/sharding** — premature before there's evidence of hitting the single-node ceiling; adds real operational complexity (resharding, cross-slot operations) for a problem not yet measured.
- **A dedicated Thread model / full thread aggregation** — the current filtered-query approach is honest about what it is and works; don't build a heavier abstraction until reply volume actually demands denormalized counts.
- **External search service (OpenSearch/Meilisearch/etc.)** — start with Postgres full-text search; only reach for an external index if cross-conversation relevance search becomes an actual product requirement.
- **Application-level message-content encryption** — no evidence of a compliance requirement driving this yet; infra-level encryption-at-rest is the right starting point, revisit if a customer contract requires it.
- **A general-purpose event-sourcing rewrite of the whole chat pipeline** — the outbox addition in Phase 2 gets the reliability win without discarding the working persist-then-publish design.
- **Automated spam/ML-based abuse detection** — build the manual block/report/mute/ban primitives first (Phase 6); automated detection is a layer on top, not a prerequisite.

## 9. Minimum Chat MVP Raven can publicly release
Everything in the "already solid" list from the audit (send/edit/delete, reactions, read receipts, typing, presence, cursor pagination, webhooks, chat tokens/auth, rate limiting) **plus**:
- A working attachment storage driver in production (it's coded, just not configured — this is a blocking bug for any public release that mentions attachments)
- Basic moderation: block + report at minimum (mute/ban can follow shortly after, but shipping public chat with zero abuse-reporting mechanism is not defensible)
- Automatic reconnect catch-up wired into every client SDK (even if the underlying mechanism stays REST-cursor-based rather than a full outbox — just make it automatic, not developer-wired)
- A documented, honest delivery-guarantee statement (even "at-least-once for persistence, best-effort for real-time push, always recoverable via history" is fine — just say it, rather than leaving it implicit)

Everything else in Phases 2–9 can follow post-launch; none of it blocks a defensible public MVP.

## 10. Architecture for 10k concurrent connections
The current architecture handles this with modest changes: 2–4 API instances behind a load balancer (already proven to work correctly via the existing Redis fan-out and validated by `scripts/chat-load-test.mjs`), a single Redis instance is very likely still sufficient at this scale (fan-out volume at 10k connections is well within a single modern Redis node's throughput), one Postgres primary with connection pooling (PgBouncer if not already present), and the storage-driver fix from Phase 1. The main thing actually required before calling this "production-ready" at 10k is Phase 2 (reliability) and Phase 6 (moderation) — capacity is not the blocker at this scale, correctness and safety are.

## 11. Architecture for 100k+ concurrent connections
This is where the single-Redis-node ceiling identified in `CHAT_ARCHITECTURE.md` §3 becomes a real constraint, not a theoretical one:
- **Redis Cluster**, sharding pub/sub channels by a hash of `conversationId` across multiple nodes, each handling a fraction of total fan-out and presence/rate-limit traffic; Sentinel alone (HA without sharding) is not sufficient at this volume.
- **Many more API/gateway instances**, each still holding its own in-process session/room maps (this part of the design already scales linearly — it was built for this).
- **Postgres read replicas** for history/pagination reads, keeping the primary focused on writes; consider a caching layer (Redis or in-memory LRU per instance) in front of "last N messages" for hot conversations.
- **Table partitioning** on `chat_messages` by `createdAt`, paired with an actually-configured retention policy — an unbounded table at this connection scale will accumulate write volume that makes partitioning a necessity, not an optimization.
- **The outbox from Phase 2 becomes more important, not less** — at this scale, transient Redis hiccups affecting even a small percentage of fan-out events translate into a large absolute number of "silently dropped, only recoverable via manual refetch" events; the outbox's replay path is what keeps that invisible to users.
- **Full observability (Phase 7) is a hard prerequisite**, not optional, at this scale — diagnosing an incident across hundreds of gateway instances without tracing/percentile metrics is not realistically possible.

## 12. Features that would make Raven Chat meaningfully better than a basic Agora Chat clone
- **An honest, documented delivery guarantee with automatic client-side catch-up** — most "Agora Chat clone" projects leave this exactly as implicit as Raven does today; actually solving Phase 2 and documenting it clearly is a real differentiator, not just parity.
- **Cross-language SDK parity as a first-class design constraint** — Raven already does this unusually well for the raw-WebSocket SDKs (Web/Flutter/RN share an intentionally aligned wire protocol); extending that same discipline to hooks (React Native) and to moderation/mention/pin methods as they're built would keep this advantage rather than let it erode.
- **A genuinely usable dashboard for trust & safety** — most competitors bolt moderation UI on late; building the Phase 6 report-review queue as a first-class dashboard experience (not just a REST endpoint) from the start is a real product wedge.
- **Structural multi-tenancy (RLS) as a selling point for enterprise/regulated customers** — "our isolation is enforced by the database, not just by our code" is a meaningfully stronger security claim than most competitors can make, and Raven already has the RLS pattern proven elsewhere in the platform.
- **Transparent, real load-test-backed capacity numbers** — the existing `scripts/chat-load-test.mjs` + documented measured-limits pattern is already better practice than most vendors' marketing-only capacity claims; keeping this updated and public as the architecture scales is cheap and builds real trust.
- **First-class mention-driven notifications and search built on Postgres full-text before reaching for a separate search service** — keeps operational surface area small while still shipping the features that actually drive daily engagement.
