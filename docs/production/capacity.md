# Live Streaming capacity

What the current implementation has actually been measured doing, what its
configured ceilings are, and — said plainly — what has not been tested.

This document is referenced from `configuration.ts`, `app-error.ts`,
`error-codes.ts` and from the Swagger descriptions on both credential-mint
endpoints, so it is the answer an external developer gets when they hit a
`503 RAVEN_CAPACITY_EXCEEDED`.

For the older, pre-SFU measurements of the REST and Chat surfaces, see
[`capacity-report.md`](./capacity-report.md). That report is LiveKit-era for
the media plane and its §1.3 bcrypt finding is the one this pass finally
fixed.

---

## The headline

> **The recommended public limit is 50 viewers per stream, 10 publishers
> per stream.** 100 concurrent *credential mints* are measured and pass —
> a control-plane operation that finishes in milliseconds. Holding
> sustained *media* is a different, longer-lived commitment, and it has
> now been measured too: see
> [`live-streaming-media-capacity.md`](./live-streaming-media-capacity.md)
> for the real-browser, real-SFU results this recommendation is built on.

Those are different claims and the difference matters. Minting a token is a
control-plane operation that finishes in milliseconds; carrying a viewer's
media is a media-plane commitment that lasts as long as the stream.

---

## Measured: viewer-token minting

Source: `apps/api/test/live-streams-capacity.e2e-spec.ts`, run
`pnpm --filter @raven/api test:e2e live-streams-capacity`.

Test rig, because a number without one is not a measurement: Apple M1 Pro,
10 cores, 17 GB, Node v26.3.1, one API process, local Postgres 15
(`max_connections=100`), Redis 7 in Docker, `DATABASE_POOL_MAX=10`. Client
and server on the same machine, so these latencies exclude real network RTT.

Each mint is genuinely database-heavy — a stream lookup, a room lookup, an
allowance check, a participant upsert, a token insert, a conversation lookup
and a chat-membership upsert.

| Concurrent mints | 201 | Rejected | 5xx | p50 | p95 | Wall |
| ---------------- | --- | -------- | --- | ----- | ----- | ----- |
| 10               | 10  | 0        | 0   | 83ms  | 91ms  | 91ms  |
| 25               | 25  | 0        | 0   | 103ms | 119ms | 119ms |
| 50               | 50  | 0        | 0   | 111ms | 150ms | 150ms |
| 100              | 100 | 0        | 0   | 204ms | 297ms | 305ms |

**Zero 500s at every tier, and nothing shed at or below 100.** That is the
whole point of the release: the queue turns a burst into latency rather than
failure.

### Controlled overload

Two different controls, reached two different ways. Worth keeping them
straight, because the obvious test only reaches the first one.

| Burst                        | 201 | Rejected | Status | Code                      |
| ---------------------------- | --- | -------- | ------ | ------------------------- |
| 400 on **one** API key       | 120 | 280      | 429    | `RAVEN_RATE_LIMITED`      |
| 400 across **four** API keys | 265 | 135      | 503    | `RAVEN_CAPACITY_EXCEEDED` |

- **One key** is stopped by the per-key rate limiter first: this route
  allows 120 per window, so 120 pass and the rest are refused *before*
  occupying an admission slot. That ordering is deliberate — abusive traffic
  from one key must not consume the capacity the limiter exists to protect.
- **Four keys**, each politely inside its own budget, is the case a per-key
  limiter structurally cannot see. Nothing is rate limited, and the
  process-wide admission ceiling is what decides. It sheds as `503`, with
  `retryAfterSeconds` and the `limit` that was hit.

The 503 count varies between runs (91–135 observed) because it depends on
how fast the queue drains while the burst is still arriving. The invariant
under test is not the count; it is that **every refusal is coded and no
refusal is a 500**.

### After the burst

The pool recovers. A single unconcurrent mint straight after the overload
tiers succeeds, and `pg_stat_activity` stays within `DATABASE_POOL_MAX`
plus headroom — so connections were held, not leaked.

---

## The bottleneck that was actually in the way

`bcryptjs` is a pure-JavaScript bcrypt whose "async" API wraps a
*synchronous* computation: it blocks Node's one thread for the whole
comparison. Every API-key-authenticated request paid ~75ms of it, and the
mints in a viewer burst all carry the same project key.

Measured on the same rig, by reverting only the verify cache
(`ApiKeysService.verifiedSecrets`) and re-running the identical suite:

| Concurrent mints | p95 with cache | p95 without | Factor    |
| ---------------- | -------------- | ----------- | --------- |
| 10               | 91ms           | 780ms       | 8.6×      |
| 25               | 119ms          | 1,885ms     | 15.8×     |
| 50               | 150ms          | 3,742ms     | 25×       |
| 100              | **297ms**      | **7,442ms** | **25×**   |

7,445ms of wall time for 100 requests is 74.5ms each, perfectly serialized
— the event loop doing one bcrypt at a time and nothing else. That is a hard
**~13 requests/second per process** for the entire authenticated REST
surface, whatever the database is doing.

What is cached is the comparison result only. The key's row is still read
from Postgres on **every** request and its `status` checked on every
request, so revoking a key takes effect immediately. An entry is bound to
the `secretHash` it was verified against, so rotation invalidates it
implicitly.

---

## Configured limits

All explicit, all overridable, all validated at boot
(`env.validation.ts`).

| Setting                            | Default            | What it bounds                              |
| ---------------------------------- | ------------------ | ------------------------------------------- |
| `DATABASE_POOL_MAX`                | 10                 | Postgres connections per API process        |
| `CAPACITY_MINT_CONCURRENCY`        | = `DATABASE_POOL_MAX` | Concurrent database-heavy mints per process |
| `CAPACITY_MINT_QUEUE_DEPTH`        | 200                | Mints held waiting before shedding          |
| `CAPACITY_MINT_QUEUE_TIMEOUT_MS`   | 20000              | How long a queued mint waits                |
| `API_KEY_VERIFY_CACHE_TTL_SECONDS` | 60                 | Verified-secret cache lifetime              |
| `SFU_ROOM_CAPACITY`                | 100                | Rooms per SFU node                          |
| `SIGNALING_MAX_PARTICIPANTS_PER_ROOM` | 50              | Participants per room                       |
| `RATE_LIMIT_WINDOW_SECONDS`        | 60                 | Rate-limit window                           |
| Route limit: viewer-tokens         | 120/window/key     | Per-key mint rate                           |
| Route limit: hosts                 | 60/window/key      | Per-key host-registration rate              |

Two cross-checks run at boot rather than as range checks, because neither
can be caught by looking at one variable:

- `CAPACITY_MINT_CONCURRENCY` must not exceed `DATABASE_POOL_MAX`. A ceiling
  above the pool it protects is not a ceiling: the surplus queues inside
  `pg` and fails as an unexplained 500, which is the exact failure this
  machinery exists to prevent.
- `CAPACITY_MINT_QUEUE_TIMEOUT_MS` must be long enough to drain a full
  queue. A deadline shorter than that refuses the tail of every legitimate
  burst, which looks like a capacity problem and is really a configuration
  one.

**Horizontal scaling note.** Every pod's pool competes for one Postgres
`max_connections`. `N pods × DATABASE_POOL_MAX` is the real limit on API
scaling, and the admission ceiling is per-process — so N pods admit N × 10
concurrent mints. Raise the pool and the ceiling follows it automatically.

---

## What overload looks like on the wire

| Status | Code                        | Meaning                                                        | Retry?                     |
| ------ | --------------------------- | -------------------------------------------------------------- | -------------------------- |
| 429    | `RAVEN_RATE_LIMITED`        | *You* asked too often. Budget refills on a known schedule.     | After the window           |
| 503    | `RAVEN_CAPACITY_EXCEEDED`   | *We* are momentarily full. Clears in about one request's time. | Yes — `retryAfterSeconds`  |
| 503    | `RAVEN_RTC_SERVER_UNAVAILABLE` | This room's SFU is unhealthy and the room can't be moved.   | Yes                        |
| 503    | `RAVEN_NO_RTC_CAPACITY`     | The fleet had nowhere to put a new room.                       | Yes, or another region     |

A client that treats 429 and 503 identically will back off a whole window
for something that clears in milliseconds. They are kept apart on purpose.

---

## Current validated capacity

```text
Per-room (configured):
- 50 participants   (SIGNALING_MAX_PARTICIPANTS_PER_ROOM)
- 100 rooms per SFU (SFU_ROOM_CAPACITY)

Token mint (measured, one API process):
- 100 concurrent successful, p95 297ms, zero 5xx
- Controlled rejection past the ceiling: 503 RAVEN_CAPACITY_EXCEEDED
- Per-key rate ceiling reached first at 120/window on one key

API (measured):
- ~318 mints/sec sustained through one process during the 100-burst
  (100 mints / 305ms wall)
- ~13 req/sec was the pre-fix ceiling, bcrypt-bound
- Multi-instance (1/2/3 processes): measured, zero errors at any count,
  connections stay within both the per-instance pool and Postgres's real
  max_connections — see live-streaming-media-capacity.md §7

SFU media (measured — real browsers, real PeerConnections, real RTP):
- 50 viewers: 30 minutes sustained, 0.00% loss, zero degradation
- 100 viewers: 20 minutes sustained (lower-bitrate profile), 0.00% loss
- 86.2 Mbps outbound at 50 viewers (real camera-quality bitrate), 20.4% CPU
- Full detail, methodology and the two profiles' distinction:
  live-streaming-media-capacity.md

Recommended initial public limit:
- 50 viewers per stream, 10 publishers per stream
  (unchanged from before — now backed by measured sustained media
  rather than being the smallest configured ceiling by default)

Unvalidated:
- 100 viewers with sustained media *at real camera-quality bitrate*
  (validated at a lower bitrate profile; see the media-capacity doc)
- One room across more than one SFU (not implemented — see below)
```

### Why 50, and not the 100 the config allows

`SFU_ROOM_CAPACITY=100` bounds *rooms per node*, not viewers per room.
Viewers per room is bounded by `SIGNALING_MAX_PARTICIPANTS_PER_ROOM=50`,
and even that is a configured number rather than a measured one. Publishing
50 as the public limit means publishing a number that is at most the
smallest configured ceiling — not one derived from a media test nobody ran.

---

## Not measured, stated rather than implied

Superseded by [`live-streaming-media-capacity.md`](./live-streaming-media-capacity.md),
which measured sustained media, SFU throughput, multi-instance API,
soak/churn resilience, and emulated network conditions. What remains
genuinely unmeasured:

- **100 viewers at real camera-quality bitrate, sustained.** Validated at
  a lower bitrate profile and as a brief snapshot at full bitrate; not
  both together, for long enough to call it sustained. Blocked by the
  load-generating laptop's own capacity, not the SFU's.
- **Real geographic network conditions.** The network-conditions testing
  that was done is emulated (`tc netem` on a containerised node's own
  interface), not multi-region. See the media-capacity doc's §8 for the
  distinction.

## Known architectural limits (by design, not defects)

1. One room is served by one SFU node.
2. There is no large-scale fan-out, and none was added in this pass.
3. Audience scaling past one node's room capacity is not supported.
4. An active room is **never** migrated between SFUs. If its node goes
   unhealthy while participants remain, new joins are refused with
   `RAVEN_RTC_SERVER_UNAVAILABLE` and the room is preserved — migrating
   would mean renegotiating every PeerConnection against a node holding
   none of their media state. An *empty* room pinned to a dead node is
   released and reallocated on its next join.
5. `participantDisconnected` on a clean leave is a known semantic gap.
6. Viewer-lifecycle webhooks follow explicit SDK calls, not socket
   lifetime: only a clean `stream.leave()` fires `live_stream.viewer_left`.
