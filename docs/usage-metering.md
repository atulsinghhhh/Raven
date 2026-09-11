# Usage Metering (free tier)

Every registered developer is granted three independent free-tier
allowances — RTC participant-minutes, Chat messages, and Live Streaming
host-hours — and using one never draws down another. This document is the
design: what is stored, who writes it, why it cannot be double-counted, and
what is deliberately not here.

The developer-facing version is `apps/docs/content/concepts/usage.md`.
This one is for whoever changes the code.

Until this phase, there was a single shared RTC-minutes pool, and Live
Streaming's hosts and viewers spent against it silently — a stream host was
indistinguishable from an ordinary call participant at the metering layer.
That coupling is gone. See [Live Streaming's own allowance](#live-streaming-host-hours-not-rtc-minutes)
below for how it was broken apart.

## Scope

**In:** RTC participant-minutes, Chat messages, and Live Streaming
host-hours, all metered server-side; a per-developer entitlement per
product; read APIs; the dashboard surface; enforcement at the relevant mint
point and, for RTC/Live Streaming, at room join. Live Streaming's
concurrency, viewer-count and stream-duration product limits (distinct from
the host-hours allowance — see [below](#live-streaming-product-limits-not-usage-metering)).

**Out, on purpose:** an admin portal, admin roles, admin authentication,
billing, plans, subscriptions, promotional credits, manual quota
adjustment, and a reset/period mechanism — none of the three allowances
reset, ever, matching RTC's original design (see
[Provisioning](#provisioning)). None of those exist as code, config,
endpoint or schema. § [What this phase does not include](#what-this-phase-does-not-include)
covers what a future phase would add and why it does not need a schema
rewrite to do it.

## The data model

Two tables (`apps/api/prisma/schema.prisma`), and the split is the design —
now shared across all three products via a `UsageProduct` discriminator
(`RTC` | `CHAT` | `LIVE_STREAMING`) rather than three parallel table sets.
`UsageKind`'s own doc comment anticipated exactly this: "to meter something
other than RTC: add a value to the enum" — extending the existing tables was
the intended growth path, not a new design.

### `usage_allowances` — the entitlement

Up to one row per `(developer, product)` — `@@unique([userId, product])`,
widened from the original `userId`-only uniqueness.

| Column | Why it exists |
|---|---|
| `product` | `RTC`, `CHAT`, or `LIVE_STREAMING`. Existing rows (all created before this column existed) backfilled to `RTC`, which is what they always implicitly meant. |
| `includedMinutes` / `consumedSeconds` | RTC and LIVE_STREAMING only — both are duration-based and share these fields, in seconds/minutes exactly as RTC always used them. `includedMinutes` is nullable now that CHAT rows exist and never populate it. |
| `includedCount` / `consumedCount` | CHAT only — messages are discrete, already-deduplicated counts, not durations. `consumedCount` is incremented by a plain atomic `+1`, not a compare-and-swap (see [Chat: why no CAS](#chat-why-no-compare-and-swap)). |
| `exhaustedAt` | When consumption first reached the included amount, for that product. Stamped once, never cleared. |
| `source` | `FREE_TIER` today. Unchanged. |

`includedMinutes`/`includedCount` are *columns*, snapshotted at provisioning
— not constants the API re-reads: lowering a product's free-tier default
later must not take anything away from an account that already has it, and
raising it must not retroactively grant more. `consumedSeconds`/`consumedCount`
are denormalised because enforcement reads them on the hot path (RTC/Live
Streaming join, Chat send), where re-deriving the total from history on
every check is the wrong query to run.

### `usage_sessions` — the meter, and the history (RTC and Live Streaming only)

One row per RTC or Live-Streaming-host participant-session — CHAT has no
session concept, see below. Also the usage history the dashboard lists for
those two products.

| Column | Why it exists |
|---|---|
| `sessionKey` | The signaling connection id — `randomUUID()` in `SignalingGateway.handleConnection`. Unique, which is what makes `startSession` idempotent under a retried join, and what makes a reconnect's gap naturally excluded (see [Live Streaming host-hours](#live-streaming-host-hours-not-rtc-minutes)). |
| `product` | `RTC` or `LIVE_STREAMING` — which allowance this session drew against. Existing rows backfilled to `RTC`. |
| `kind` | `RTC_PARTICIPANT_MINUTES` or `LIVE_STREAMING_HOST_MINUTES`. |
| `meteredSeconds` | High-water mark of how much of this session has already been credited. The whole no-double-count argument rests on it. |
| `lastMeteredAt` | Last instant the session was confirmed alive *and* settled. |
| `endedAt` / `closeReason` | Null while live. `left`, `abandoned` or `shutdown`. |
| `userId`, `projectId`, `environment`, `roomName`, `participantIdentity` | Denormalised attribution. |

### Why not `Connection`?

Unchanged from RTC's original reasoning: `Connection` is event-sourced from
client-SDK telemetry, fire-and-forget and gameable. `usage_sessions` is
written only by the signaling plane, from the server's own clock.

## Attribution: the project owner's allowance

Unchanged, now true of all three products: a project's usage spends the
allowance of the account that **owns** the project, whoever is in the
room/conversation/stream. `UsageAllowance` has no `Environment` column at
all — a project's dev, staging and production usage all draw one pool, for
every product. The Live Streaming concurrency cap uses the same
account-wide attribution (see below), deliberately, for consistency with
everything else here.

## Provisioning

`UsageAllowanceService.ensureProvisioned(userId, product)` — an upsert with
an **empty update**, unchanged in shape from before, now keyed on
`(userId, product)` and reading the right config default per product:

| Product | Config key | Env var | Default |
|---|---|---|---|
| RTC | `usage.freeTierRtcMinutes` | `USAGE_FREE_TIER_RTC_MINUTES` | `10000` |
| CHAT | `usage.freeTierChatMessages` | `USAGE_FREE_TIER_CHAT_MESSAGES` | `100000` |
| LIVE_STREAMING | `usage.freeTierLiveHostHours` | `USAGE_FREE_TIER_LIVE_HOST_HOURS` | `100` |

The empty `update` is the important half, same reasoning as always: this is
called on every read/write path for a given product, and must not reset a
spent allowance or resize an existing one.

**RTC's default dropped from 20,000 to 10,000 — existing accounts are
unaffected.** Because the upsert's `update: {}` never touches an existing
row, this only changes what *newly registered* accounts get; anyone who
registered before this change keeps their original `includedMinutes: 20000`
forever. There is no data migration that shrinks an existing balance — that
would be a destructive change nothing here asked for, and the architecture
already makes it unnecessary.

**RTC provisioning stays eager (registration, OAuth sign-in); CHAT and
LIVE_STREAMING are lazy only.** Registration and OAuth sign-in call
`ensureProvisioned(userId, RTC)`, same as before this change — no eager
backfill was added for the other two products, no migration inserts
`usage_allowances` rows for them either. The first time an account sends a
chat message or registers as a live-stream host, that product's allowance
is provisioned then, exactly the same lazy-backfill mechanism that already
handles pre-metering-era accounts touching RTC for the first time. This
keeps the migration cheap (no full-table backfill for two brand-new
products) and needed no new machinery.

## Why it cannot double-count

### RTC and Live Streaming: the compare-and-swap

Unchanged. `UsageMeterService.settleRow` is the single write path for both
duration-based products — it does not branch on `product` at all, only on
`startedAt`/`meteredSeconds`/`allowanceId`, which is exactly why extending
it to a second product needed no new accounting logic:

1. read the session's current `meteredSeconds`
2. `delta = elapsed - meteredSeconds`; stop if `delta <= 0`
3. move `meteredSeconds` to `elapsed` with a **compare-and-swap** on the
   value read in (1) — `updateMany({ where: { id, meteredSeconds: <read> } })`
4. add exactly that `delta` to the allowance, **in the same transaction** as (3)

### Live Streaming host-hours: not RTC minutes

Live-stream hosts and co-hosts used to be indistinguishable from ordinary
RTC participants: `MessageRouterService.handleJoin` opened a meter for
every join with no awareness of `LiveStream` at all. That coupling is
broken at two points:

1. **Credential minting.** `RtcTokensService.create` is split into
   `assertProjectWithinAllowance(...) + mintRawCredential(...)`. Live
   Streaming's `mintCredential` calls `mintRawCredential` directly — never
   `create` — so a live-stream credential is never gated by the RTC
   allowance at all. There is no boolean flag to misconfigure; the RTC gate
   simply isn't reachable from that path.
2. **Room join.** `MessageRouterService.handleJoin` widens its existing
   `room.findUnique` query (already runs on every join — zero extra round
   trips) to also select whether the room backs a `LiveStream` and whether
   this participant is a registered, non-removed host/co-host of it:
   - not a live-stream room → unchanged RTC path.
   - live-stream room, registered host/co-host → meters against
     `LIVE_STREAMING` instead of `RTC`, with
     `kind: LIVE_STREAMING_HOST_MINUTES`.
   - live-stream room, not a registered host (a viewer) → **no meter opens
     at all.** Viewers are free — bounded only by the
     [product limits](#live-streaming-product-limits-not-usage-metering)
     below, never by a per-minute allowance.

Reconnect gaps are excluded for free, by the same mechanism RTC always
had: each WebSocket connection is its own `sessionKey`/session row, so a
host who drops and rejoins produces two sessions, summed independently.
10:00–10:20 then 10:25–10:40 credits 35 minutes, not 40 — the 5-minute gap
was never open a session.

`LiveStreamsService.addHost()` gates host/co-host registration against the
LIVE_STREAMING allowance before minting (mirrors RTC's own mint-time gate);
`createViewerToken()` has no such gate.

### Chat: why no compare-and-swap

A chat message is a different shape of problem: a single, discrete,
already-deduplicated event, not a duration re-measured at multiple
instants. The DB unique constraint on `(conversationId, senderId,
clientMessageId)` already guarantees `MessagesService.send()`'s persist
step runs at most once per genuinely new message — a CAS would be solving a
race that structurally cannot happen here. So counting is a plain atomic
`consumedCount: { increment: 1 }`, called once, from the same branch that
also fires the `messages_sent` metric (i.e. never on the deduplicated-retry
return path).

**Counted once per message, never once per recipient.** The increment sits
at persistence, before fan-out (`ChatEventsService.publish`) — fan-out is a
separate, later, best-effort step that can deliver to any number of
sockets without touching the counter again.

**What does *not* reach this counter, and why:** typing indicators and
presence are pure Redis, never touch Postgres, and physically cannot reach
`MessagesService.send()`. Read receipts are a single upserted position row
per (conversation, user), written by a different service entirely.
Reactions are their own table (`chat_reactions`), written by
`ReactionsService.add()`/`remove()` via `prisma.reaction.upsert` — a
completely separate code path from `prisma.message.create`. None of these
can be miscounted as a message, because none of them call the method the
counter lives in.

**Enforcement** sits between the idempotency-cache short-circuit and the
more expensive validation/loading steps in `send()` — after the dedup
check, so a legitimate retry of an already-sent message is never wrongly
blocked once the quota is hit; before the expensive work, so a request
that's about to be refused doesn't pay for it first.

## Live Streaming: product limits, not usage metering

Three free-tier ceilings that are deliberately **not** part of the
`UsageAllowance`/host-hours accounting above — a viewer never consumes
anything, and these are gate checks against a live/derived state, not a
running balance:

| Limit | Config | Default | Enforced |
|---|---|---|---|
| Concurrent streams | `USAGE_FREE_TIER_LIVE_CONCURRENT_STREAMS` | `1` | A **partial unique index**, `live_streams_one_live_per_owner` (`ON live_streams(ownerId) WHERE status = 'LIVE'`), not a count-then-act check. `LiveStreamsService.start()`'s existing conditional `updateMany` becomes the enforcement point for free — a unique-violation is caught and translated into `LiveStreamConcurrencyLimitExceededError` (403, `RAVEN_STREAM_CONCURRENCY_LIMIT_EXCEEDED`). Account-wide, across every project and environment — same attribution as the allowances above. A naive `count()`-before-`start()` check would race (two `start()` calls on two different `CREATED` streams for the same owner can both observe zero and both succeed); the database constraint cannot. |
| Viewers per stream | `USAGE_FREE_TIER_LIVE_MAX_VIEWERS` | `100` | `LiveStreamsService.createViewerToken()` reuses the same SFU-derived count `toView()` already computes for `viewerCount` — no new state. Best-effort, not atomic: a burst of concurrent joins can briefly overshoot. **Fails open** (logs and allows) if the SFU is unreachable, matching this module's existing "never block on a Livqeno fault" posture. |
| Stream duration | `USAGE_FREE_TIER_LIVE_MAX_STREAM_DURATION_MINUTES` | `240` | An interval-driven reaper (`LiveStreamsService.reapOverdueStreams`, `setInterval` on `usage.reaperIntervalMs`, same idiom as `UsageMeterService.reap()`) force-ends any stream `LIVE` past this duration via the *existing* `end()` transition — no duplicated lifecycle logic. |

**The generic room-participant ceiling was raised for live-stream rooms
specifically.** `SIGNALING_MAX_PARTICIPANTS_PER_ROOM` (default `50`) caps
every ordinary room, and 100 viewers plus hosts/co-hosts would exceed it —
so the advertised viewer cap would be silently unreachable at the actual
WebSocket-join layer even with the mint-time check correctly in place.
`RoomRegistryService.join()` now accepts an optional ceiling override;
`MessageRouterService.handleJoin` passes
`SIGNALING_MAX_PARTICIPANTS_PER_LIVE_STREAM_ROOM` (default `150`) for a
room that backs a `LiveStream`, using the same live-stream detection it
already does for the metering branch above — one query, two decisions.

## Reliability: sweep, then reap

Unchanged for RTC and Live Streaming — both go through the same
`UsageMeterService`:

| Trigger | Where | Credits up to |
|---|---|---|
| Join | `MessageRouterService.handleJoin` | — (opens the meter, RTC or LIVE_STREAMING) |
| Periodic sweep, per instance | `SignalingGateway.runUsageSweep`, every `USAGE_METER_INTERVAL_MS` | now |
| Leave | `MessageRouterService.handleLeave` | now, and closes |
| Clean shutdown | `SignalingGateway.onModuleDestroy` | now, and closes |
| Reaper | `UsageMeterService.reap`, every `USAGE_REAPER_INTERVAL_MS` | **`lastMeteredAt`**, and closes |

Chat has no equivalent — a message increment is a one-shot atomic write at
persistence time, with nothing left running that a sweep or reaper would
need to settle.

## Metering never fails a call

Unchanged principle, now covering all three products: `startSession`,
`settle`, and Chat's `recordChatMessage` are all best-effort at their call
sites — logged and swallowed, never allowed to fail a join, leave, or send.

## Enforcement

| Product | Gate 1 (mint/pre-write) | Gate 2 (join) |
|---|---|---|
| RTC | `RtcTokensService.create` | `MessageRouterService.handleJoin` |
| CHAT | — (no mint step) | `MessagesService.send()`, before persist |
| LIVE_STREAMING | `LiveStreamsService.addHost()` | `MessageRouterService.handleJoin`, same query, different branch |

All three raise `UsageLimitExceededError` — 403, `RAVEN_USAGE_LIMIT_EXCEEDED`
— with `details` generalised to `{ product, unit, included, used, remaining }`.
**RTC's error additionally carries the legacy `includedMinutes` /
`usedMinutes` / `remainingMinutes` keys**, unchanged, for backward
compatibility with any existing SDK/dashboard code parsing those exact
field names — CHAT and LIVE_STREAMING are new error occurrences with
nothing to break.

**Sessions/messages in progress are never consulted against the limit** —
unchanged reasoning: a hard stop mid-call or mid-send is a worse failure
than overshooting by one unit, and every read path clamps the *display*
(never the stored value) at 100%/zero-remaining.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `USAGE_FREE_TIER_RTC_MINUTES` | `10000` | Minutes granted to **newly provisioned** RTC allowances. Renamed from `USAGE_FREE_TIER_MINUTES` — the old name no longer said which product it granted. |
| `USAGE_FREE_TIER_CHAT_MESSAGES` | `100000` | Messages granted to newly provisioned Chat allowances. |
| `USAGE_FREE_TIER_LIVE_HOST_HOURS` | `100` | Host-hours granted to newly provisioned Live Streaming allowances. |
| `USAGE_FREE_TIER_LIVE_CONCURRENT_STREAMS` | `1` | Max concurrent LIVE streams per account, enforced by a database constraint — see above. |
| `USAGE_FREE_TIER_LIVE_MAX_VIEWERS` | `100` | Max viewers per stream, best-effort. |
| `USAGE_FREE_TIER_LIVE_MAX_STREAM_DURATION_MINUTES` | `240` | Max wall-clock duration of one stream, enforced by an interval reaper. |
| `SIGNALING_MAX_PARTICIPANTS_PER_LIVE_STREAM_ROOM` | `150` | The raised room ceiling for a live-stream room — see above. |
| `USAGE_ENFORCE_LIMIT` | `true` | `false` keeps metering but stops refusing usage, for every product. For a self-hosted deployment with no reason to cap itself. |
| `USAGE_METER_INTERVAL_MS` | `30000` | Per-instance sweep interval (RTC and Live Streaming). |
| `USAGE_REAPER_INTERVAL_MS` | `60000` | How often abandoned RTC/Live-Streaming sessions — and overdue live streams — are looked for. Reused for both reapers rather than adding a second interval config. |
| `USAGE_ABANDONED_AFTER_MS` | `180000` | A live RTC/Live-Streaming session not settled inside this window is closed. |

With enforcement off, every product's `checkProject`/pre-send check still
reports `exhausted: true` and only `blocked` goes false.

**None of the three allowances reset — not monthly, not on any schedule.**
This mirrors RTC's original, deliberate design: the platform has no
period/reset mechanism anywhere, and building one would be a materially
larger change (new period semantics, a reworked `exhaustedAt` that can be
cleared, changed dashboard history bucketing) than everything else in this
document combined. If a future phase adds monthly resets, it is exactly
that: a future phase.

## API

All routes take a dashboard session JWT. All are read-only.

| Route | Returns |
|---|---|
| `GET /v1/usage` | The RTC summary, flat at the top level exactly as before (`includedMinutes`, `usedMinutes`, …, unchanged for backward compatibility), plus two new sibling keys: `chat: { used, limit, unit: 'messages' }` and `liveStreaming: { hostHoursUsed, hostHoursLimit, concurrentStreams, maxConcurrentStreams, maxViewers, maxStreamDurationMinutes }`. |
| `GET /v1/usage/detail?limit=&days=` | The RTC summary (nested under `summary`, unchanged) plus RTC history/daily/byProject (unchanged), plus the same `chat`/`liveStreaming` blocks as above. |
| `GET /v1/projects/:projectId/usage?limit=&days=` | One project's RTC history against its **owner's** summary (unchanged), plus the owner's account-wide `chat`/`liveStreaming` blocks — not filtered to this project, since both are account-wide pools. `ownedByCaller` says whether that owner is the caller. |

**Chat and Live Streaming get summary figures only, in this phase — no
history/daily/per-project breakdown yet**, unlike RTC. `UsageSession` (the
table RTC's history is built from) now also carries Live Streaming host
sessions, and every RTC history/chart/rollup query in
`UsageAllowanceService` explicitly filters `product: RTC` so a live-stream
host's connected time never silently pollutes the RTC dashboard. Adding an
equivalent history view for the other two products is a documented known
limitation, not an oversight.

## Dashboard

- `/dashboard/usage` — account-level. Three independent cards — RTC, Chat,
  Live Streaming — each with its own meter, plus the RTC 30-day chart, the
  per-project breakdown, and the RTC session history.
- `/dashboard/projects/:id/usage` — the RTC meter narrowed to one project,
  plus the owner's account-wide Chat/Live Streaming cards, alongside that
  project's live infrastructure snapshot.

The account page's "What is and isn't metered" card, and the project page's
"Not metered" card, both used to state plainly that Chat and Live Streaming
were not metered at all. That is now false and both have been corrected —
see `apps/dashboard/src/app/dashboard/usage/page.tsx` and
`.../projects/[projectId]/usage/page.tsx`.

There is still no `20000` — or `10000`, `100000`, `100` — anywhere in
`apps/dashboard`. Every figure arrives from the API's response.

## Tests

| Where | Covers |
|---|---|
| `usage-allowance.service.spec.ts` | Allocation, idempotent provisioning per product, owner resolution, summary derivation, flooring, clamping, enforcement on/off, history (RTC-scoped), rollups. |
| `usage-meter.service.spec.ts` | Consumption, delta-only crediting, idempotency, interleaved settlements, the reaper's instant, exhaustion stamping — product-agnostic, exercised for both RTC and LIVE_STREAMING sessions. |
| `message-router.service.spec.ts` | Join refused when exhausted (per product), admitted when enforcement is off, meter opened with server-side state only, no meter for a refused join or a live-stream viewer, join survives a metering failure, leave closes the meter. |
| `messages.service.spec.ts` / `chat.e2e-spec.ts` | Chat quota gate and counting: allowed/rejected at the boundary, one message to many recipients counts once, retries don't double-count, typing/presence/read-receipts/reactions never touch the counter. |
| `live-streams.service.spec.ts` / `live-streams.e2e-spec.ts` | Host-hours accounting, the concurrency-race regression (two parallel `start()` calls, exactly one succeeds), viewer-cap enforcement and its SFU-timeout fail-open, the duration reaper. |
| `test/usage-metering.e2e-spec.ts` | Real Postgres: the 10,000-minute grant for new RTC accounts, existing accounts keeping their original grant, twenty parallel sessions summing exactly, eight parallel settlements of one session crediting once, counter-equals-sum, token mint refused at 403, `exhaustedAt` never rewritten, reaper crediting to `lastMeteredAt`, **cross-product isolation** (spending RTC/Chat/Live independently leaves the other two untouched), and that no endpoint exists which could grant or reset any allowance. |
| `apps/dashboard/src/__tests__/usage-panels.test.tsx` | Meter semantics and clamping for all three cards, the exhausted notice, abandoned-session labelling, no hardcoded allowance. |

## What this phase does not include

No admin portal, admin roles, admin authentication, billing, subscriptions,
paid plans, promotional credits, manual quota adjustment, or a reset/period
mechanism. `UsageModule` exposes three GET routes and nothing else; an e2e
test asserts that POST, PATCH and DELETE against every usage path 404.

The schema is shaped so that adding those is additive:

| A future phase wanting… | …changes |
|---|---|
| To raise one developer's allocation for a product | `UPDATE usage_allowances SET "includedMinutes" = … WHERE "userId" = … AND product = …`. A data change. No migration. |
| To record *why* it was raised | Add `ADMIN_GRANT` to `UsageAllowanceSource`; one `ALTER TYPE`. |
| Several concurrent grants per product (promo credits, plan + top-up) | A new `usage_grants` table summing into `includedMinutes`/`includedCount`. Additive; the `(userId, product)` uniqueness on `usage_allowances` stays meaningful. |
| To meter a fourth product | Add a value to `UsageProduct`, and if it's duration-based reuse `UsageSession`/`UsageMeterService` exactly as LIVE_STREAMING did; if it's count-based, follow Chat's plain-increment pattern. |
| Monthly (or any) resets | A genuinely new concept — a period/cycle on `UsageAllowance`, reworked `exhaustedAt` semantics, changed dashboard bucketing. Not additive in the way the rows above are; scope it as its own phase. |
| Paid usage | Everything above plus a billing subsystem. Nothing in these two tables assumes free, and nothing assumes paid. |

## A note on the RLS migrations

Unchanged from before this phase — `20260909120000_add_usage_metering` and
its two companion migrations are still the authoritative RLS story for
these tables; this phase's migration
(`20260911160000_split_usage_products_and_live_stream_caps`) only alters
existing, already-locked-down tables (`ALTER TABLE ADD COLUMN`, a widened
unique index, a new partial unique index on `live_streams`) and adds no new
table, so it needed no RLS statements of its own. See
docs/deployment/managed-postgres.md#never-name-a-role-in-a-migration for
the rule, and the original RLS section this replaced for the full history.

## Related

- `apps/docs/content/concepts/usage.md` — the developer-facing page
- `apps/docs/content/live-streaming.md` — Live Streaming's lifecycle and
  its product limits
- `docs/control-plane.md` — the two authentication models these routes sit in
- `docs/observability.md` — `Connection`, and why it is not the billing record
- `docs/rtc/signaling.md` — the join/leave lifecycle metering hangs off
