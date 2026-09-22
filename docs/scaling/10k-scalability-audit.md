# Livqeno — 10K Concurrent User Scalability Audit

This audit is evidence-based and reuses Livqeno's own existing
capacity/architecture documentation rather than re-deriving it — see the
"Sources" list at the start of each section, and every finding below
carries a file:line citation. Nothing in this document should be read as
"10,000 concurrent users is validated" — see §2 for exactly what is and
is not measured today, and §10 for what evidence is still required
before that claim could be made.

## Correction to the audit brief

The request that produced this document assumed a **Go API**. That is
incorrect and is corrected here rather than silently worked around:

- `apps/api` — the **control plane** (auth, rooms, tokens, projects,
  signaling gateway, chat gateway, live-streams, webhooks) — is
  **NestJS/TypeScript**, running on Node's single-threaded event loop per
  process.
- `services/sfu` — the **media plane** (the actual SFU: ICE, DTLS, SRTP,
  RTP/RTCP, track forwarding) — is the only Go code in the repository,
  built on [Pion](https://github.com/pion/webrtc).

Every place the original brief says "the Go API" or asks for
`go test -race` against API code, this document applies that instead to
`services/sfu` (the real Go code) and audits `apps/api` as what it
actually is: a Node/NestJS process, where "race condition" mostly means
shared-mutable-module-state races across event-loop ticks, not classic
data races a race detector would catch.

---

## 1. Current architecture (as built, not as assumed)

Sources: `docs/rtc/architecture.md`, `docs/rtc/scaling.md`,
`docs/rtc/sfu.md`, `docs/CHAT_ARCHITECTURE.md`,
`docs/deployment/managed-postgres.md`, `infrastructure/azure/README.md`.

```text
                         ┌───────────────────────────────┐
                         │        Livqeno Client SDKs       │
                         │  Web · React · React Native ·  │
                         │  Flutter · Python (server)     │
                         └────────────────┬────────────────┘
                                          │  HTTPS (REST) + WSS (signaling, chat)
                         ┌────────────────▼────────────────┐
                         │     Livqeno Control Plane (N×)     │   apps/api — NestJS/TS
                         │  Auth · Projects · Rooms ·      │   stateless per docs, Redis-
                         │  RTC/Chat tokens · Signaling    │   mediated cross-instance
                         │  gateway · Chat gateway ·       │   awareness (see §3, §5)
                         │  Live-streams · Webhooks ·      │
                         │  rtc-servers registry/allocator │
                         └───┬──────────────┬──────────────┘
                             │              │
                    node link│(WS, control  │  Redis (pub/sub, presence,
                    only)    │ only)        │  rate limits, room-membership
                             │              │  sets, token revocation)
                    ┌────────▼───────┐      │       single node today
                    │   Livqeno SFU    │      │
                    │  (Go / Pion)   │◄─────┘
                    │  services/sfu  │
                    │ 1 node deployed│
                    └───┬───────┬────┘
                        │       │
                 STUN/TURN   PostgreSQL (Supabase-managed,
                 (coturn,    transaction pooler :6543)
                 1 VM today) source of truth: rooms, participants,
                             projects, messages, usage, live streams
```

Client media never crosses the control plane — a client is handed a
signaling `endpoint` and never learns an SFU's address directly; media
goes client ↔ SFU node over WebRTC once negotiation (which does cross the
control plane, as small JSON/SDP frames) completes.

### Control plane vs. media plane

| | Control plane (`apps/api`) | Media plane (`services/sfu`) |
|---|---|---|
| Language/runtime | NestJS/TypeScript, Node event loop | Go, goroutines |
| Carries | AuthZ, room/participant state, negotiation | Audio/video/screen/data (RTP/RTCP/SRTP) |
| State | Durable in Postgres, shared in Redis | Per-call, in-process only |
| Scales by | Adding stateless instances behind a load balancer | Adding nodes; **a room lives on exactly one node** |
| Restart cost | None — clients reconnect | Drops every call on that node |

### Stateful vs. stateless, concretely

- **Stateless (safe to scale horizontally today, per docs):** the control
  plane's HTTP handlers, the signaling/chat gateway processes themselves
  (they hold sockets, but membership/fan-out is Redis-mediated — see §3).
- **Stateful, durable, in Postgres:** projects, rooms, participants (the
  durable record), messages, usage, audit logs, RTC/chat token issuance
  records, live-stream/host/viewer records.
- **Stateful, ephemeral, in Redis:** room-membership sets
  (`raven:signaling:room:<id>:participants`, TTL'd), chat pub/sub fan-out
  channels, presence, typing, rate-limit counters, chat-token revocation
  tombstones — see §3.5 for the full inventory and which of these are
  single-point-of-failure risks. (rtc-servers heartbeat/health rows are
  Postgres, not Redis — see §3.2/§3.11.)
- **Stateful, in-process only, per API instance:** the signaling
  gateway's and chat gateway's **local socket maps** (which sockets *this*
  process physically holds) — this is correct and necessary (only the
  process holding a socket can write to it), not a scaling defect, as
  long as everything that needs cross-instance visibility goes through
  Redis instead of these maps. Verification of this claim against actual
  code: confirmed in §3.11 — no such state exists beyond one deliberate, safe cache.
- **Stateful, in-process only, per SFU node:** the entire media session —
  PeerConnections, tracks, DownTracks, simulcast layer state. This is
  intentional and is what "a room lives on one node" means.

### Room ownership

- Assigned once, on first join, by the control plane's allocator
  (`rtc-server-allocator.service.ts` — least-loaded healthy node,
  region-preferred, falls back cross-region and logs it). A Redis lock +
  conditional write prevents a room being split across two nodes on a
  concurrent-join race.
- Ownership record lives on the control-plane side (Postgres/Redis —
  exact backing store confirmed in §3.2/§3.11 as Postgres, via `Room.rtcServerId`), not on the SFU
  itself. The SFU has no scheduler of its own — see §8.
- A room is released when its last participant leaves, so the next call
  is allocated fresh rather than pinned to a possibly-drained node.
- **No room migration exists.** An unhealthy node keeps its existing
  rooms; new joins to that room fail with `RAVEN_RTC_SERVER_UNAVAILABLE`
  rather than moving the room. The abstraction (`assignedServerFor` /
  `releaseRoom`) exists; the migration path does not. This is a
  documented, deliberate limitation, not an oversight.

### Can API/SFU/TURN be horizontally scaled *today*, as deployed?

| Component | Horizontally scalable today? | Evidence |
|---|---|---|
| API (`apps/api`) | **Yes, architecturally** — proven via `docker-compose.scale.yml` + measured 94.7% scaling efficiency at 2 instances for the REST control plane (`capacity-report.md` §1.3) and 1/2/3-instance live-streams token-mint scaling with zero errors (`live-streaming-media-capacity.md` §7) | Measured |
| SFU (`services/sfu`) | **Partially** — multi-node allocation code exists and is unit-tested, but only **1 SFU node has ever been deployed or tested live** (`architecture-5k.md` §2) | Coded, not exercised against real infra |
| TURN (coturn) | **No** — exactly one coturn VM deployed, explicitly a documented single point of failure (`architecture-5k.md` §2, `infrastructure/azure/README.md`) | Confirmed single instance |

### Explicit assumptions this document makes

1. The docs cited above (`docs/rtc/*`, `docs/production/*`,
   `docs/CHAT_*`) reflect the current `main` branch faithfully as of
   their stated dates; where a parallel code-verification pass found
   drift, that is called out inline rather than silently trusted.
2. "Horizontal scaling efficiency" measured in `capacity-report.md` and
   `live-streaming-media-capacity.md` was measured on a single contended
   developer laptop running multiple Docker containers side-by-side, not
   dedicated hardware — treated as a lower bound on real efficiency, not
   an upper bound, per those reports' own caveats.
3. "Currently validated capacity" throughout this document means
   *measured with evidence in the repo*, not theoretically supported by
   the architecture. The two are kept separate everywhere.

---

## 2. SFU and API capacity model — what is actually measured (not extrapolated)

Source: `docs/production/live-streaming-media-capacity.md`,
`docs/production/capacity.md`, `docs/production/architecture-5k.md`.

### Measured, real browsers, real SFU, real RTP

| Profile | Viewers | Duration | p95 join | SFU CPU | SFU RSS | Outbound | Loss |
|---|---|---|---|---|---|---|---|
| 360p (~1.73 Mbps/viewer, real camera-quality) | **50** | **30 min sustained** | 82ms | 20.4% | 253 MB | 86.2 Mbps | 0.00% |
| 360p | 75 | ~45s snapshot only | 140ms | 31.9% | 368 MB | 129.9 Mbps | 0.00% — but only 50/75 (66.7%) reached media-alive; **rig-bound (laptop decode capacity), not SFU-bound** — SFU CPU/bandwidth scaled linearly through the failure |
| 180p (~0.63 Mbps/viewer) | **100** | **20 min sustained** | 196-372ms | 27-31% | 461-481 MB | 62.5-63.1 Mbps | 0.00% |
| 180p | 125 | ~40s snapshot only | 405ms | 35.8% | 548 MB | 78.0 Mbps | 0.00% — 100/125 (80%) media-alive; same rig-bound failure mode |

Every row, at every tier: **0.00% SFU-reported packet loss.** Every
observed failure past the sustained tiers was traced to the
load-generating laptop's own Chromium decode capacity (300%+ of one core,
system load >3× core count), not to the SFU or API — confirmed by SFU
CPU/bandwidth continuing to scale perfectly linearly through the failure
point in both cases.

**Recommended public limit: 50 viewers / 10 publishers per stream.** This
is deliberately the *lower* of the two proven-sustained tiers, chosen
because it is proven at **real camera-quality bitrate** (360p), not the
lower 180p profile. 100 viewers is "the clear next target," proven at
180p for 20 minutes but not yet proven at 360p for a sustained duration
— that gap is a load-generation-hardware limit on the one laptop that
produced this data, not a known SFU limit.

### API/control-plane scaling (measured, separate surface)

| Instances | Mint throughput | Errors | p95 | Peak Postgres conns |
|---|---|---|---|---|
| 1 | 391.9 req/s | 0 | 96ms | 11 / 100 |
| 2 | 530.5 req/s | 0 | 87ms | 21 / 100 |
| 3 | 481.2 req/s | 0 | 101ms | 31 / 100 |

(600 viewer-token mints, 30-way concurrency, one shared Postgres+Redis.
The 3-instance dip is flagged in the source doc as "a single trial at
small scale," not an established ceiling.)

### What additional benchmark dimensions are required before 1K/5K/10K can be discussed with evidence

Stated plainly, per the source docs' own discipline, and not invented
here:

1. **100 viewers at 360p (real camera-quality bitrate), sustained ≥20
   minutes.** Only proven at 180p sustained, or 360p as a 45s snapshot.
   Needs a load-generation host with materially more decode headroom
   than the single developer laptop used so far, or a real multi-device
   test rig.
2. **Any tier above 125 viewers, at any bitrate, on a single SFU node.**
   Nothing above 125 has been attempted. The failure mode observed
   (rig-bound decode saturation) means the *SFU's own* per-node ceiling
   is still unknown — it has not yet been found.
3. **Multi-node SFU allocation under real load.** `pickServer()` /
   `healthyServersWithCapacity()` are unit-tested with mocked multi-node
   data (`rtc-server-allocator.service.spec.ts`) but have never routed a
   real join across two live SFU nodes. This is the single largest gap
   between "1 node's ceiling" and "N-node fleet capacity" — it is not
   safe to multiply the single-node number by node count without first
   proving allocation actually spreads load correctly live.
4. **A distributed, multi-machine load generator.** The existing rig
   (`scripts/capacity/`) runs every viewer as a headless Chrome tab on
   *one* machine sharing one renderer heap/main thread. `architecture-5k.md`
   §2 states plainly: "A 5,000-viewer run on this rig today would
   benchmark the laptop, not the fleet." The same is true for any
   4-digit target — 10,000 viewers absolutely requires containerizing and
   distributing the harness across multiple hosts before the number means
   anything.
5. **TURN relay capacity under load.** One 1GB coturn VM's relay share at
   any real concurrency has not been load-tested at all (see §3.6 —
   TURN audit).
6. **Chat at the literal 10K-connection mark.** Measured cleanly to 1,500
   connections (`capacity-report.md` §2.2); 10K is an explicit
   extrapolation in `capacity-report.md` §2.5 (⌈10,000/750⌉ ≈ 14
   instances) and in `CHAT_ROADMAP.md` §10 ("handles this with modest
   changes") — neither is a measurement.
7. **A widened production UDP/relay port range re-tested.** The
   125-viewer (180p) ceiling was CPU-underutilized (35.8%) when it hit
   its rig-bound wall, so a real per-node ceiling test needs to also rule
   out the SFU's own configured `SFU_ROOM_CAPACITY`/UDP-port-range limits
   as a false ceiling, the way `architecture-5k.md` §3 already flags.

**Do not read any number in this section as "N thousand supported."**
Every tier above is exactly what was run, on exactly the hardware
described in the source doc, and nothing has been run at 1,000+
concurrent participants/viewers on real infrastructure as of this
writing.

---

## 3. Component-by-component audit

### 3.1 SFU concurrency and hot-path findings (Go/Pion, `services/sfu`)

| # | File:Function:Line | Problem | Why it matters at scale | Severity | Recommended change |
|---|---|---|---|---|---|
| 1 | `internal/signal/server.go` `claim()`/`enqueue()` :271-298,375-380 | `Server.mu` (RWMutex) and `Server.queueMu` (Mutex) are **node-wide**, keyed by session id across every room on the node; every inbound node-link frame (SDP answer, trickled ICE candidate, mute, subscription-update, keepalive) takes both locks unconditionally | Contention today is bounded by node-link count (1-3 API instances per node), not participant count — each link's read loop is serial. Becomes the first bottleneck if link count or per-link parallelism grows | Low | Shard `owners`/`orphanedAt`/`queues` by session-id hash, or fold into the existing per-session queue struct |
| 2 | `internal/room/manager.go` `FindParticipant()` :273-287 | `Manager.mu` (node-global RWMutex over `rooms map[string]*Room`) is RLock'd to snapshot all rooms, then linearly scanned for every ICE-candidate/answer/mute frame that names a session but not a room | O(rooms-on-node) per such frame, not O(1). Cheap at `SFU_ROOM_CAPACITY=100`, but gets linearly worse exactly as node density is pushed up to lower node count for 10K users | Medium | Maintain `map[sessionID]*Room` alongside `rooms`, updated at the same `AddParticipant`/`RemoveParticipant`/`reapIfEmpty` sites, for O(1) lookup |
| 3 | `internal/room/publishedtrack.go` `forward()` :295-301 | Allocates a fresh `[]*DownTrack` slice on **every incoming RTP packet** to snapshot subscribers before releasing the lock | Real GC pressure at scale — consistent with (explains, doesn't contradict) the measured near-linear CPU-vs-participant scaling in the live benchmarks | Low | Reuse a per-`PublishedTrack` scratch slice under the same lock instead of allocating fresh each call |
| 4 | `internal/room/room.go` (architecture-level, `Room` struct :37-51, `getOrCreateRoom` `manager.go:211`) | `Room` carries no node-identity field; the SFU creates a room for **any** roomID handed to it, with zero cross-check against the control plane's assignment | Not an active bug — all protection against two nodes serving one room lives entirely in the NestJS control plane's atomic Postgres write. The SFU is a trusting layer by design (`docs/rtc/sfu.md`: "holds no application state") | Medium (defense-in-depth gap) | None required for the current design — deliberate — but document the trust boundary explicitly |
| 5 | `internal/registry/usage.go` `readResourceUsage()` :20-23,41,60-73 | `lastCPUSample`/`lastGCPause` are package-level `var`s mutated with no lock | Not a live race today (single serial ticker loop, confirmed by `go test -race`) — a latent landmine if a second call site is ever added | Low | Move into the `Client` struct as instance fields |

**No other global-across-all-rooms locks exist.** Every hot-path lock protecting frequently-mutated state (`Room.mu`, `PublishedTrack.mu`, `Participant.mu`/`negMu`/`subMu`/`iceMu`/`dataMu`, `DownTrack.mu`) is scoped to one room/track/participant — these scale correctly as room/participant count grows.

**Goroutine lifecycle.** Per-layer read loops, per-subscription RTCP drains, and per-frame dispatch goroutines all terminate on the underlying Pion I/O call erroring out (connection/track closed), not on explicit `context.Context` cancellation. No leak was observed in the 60-minute/250-churn-event soak test (goroutines flat at 1341.1→1341.3). This is real evidence against a leak at tested scale, but relies entirely on Pion's contract that closing a connection reliably unblocks every blocked `Read()` — there is no explicit cancellation backstop if that contract is ever violated.

**Cleanup races: none found.** `Room.AddParticipant` fixed a historical double-eviction race by moving reconnect-eviction + reverse-map update + insert under one lock hold (documented in-code). Deletes are identity-guarded (`r.participants[sessionID] == participant`) so a stale close can't delete a session already replaced by reconnect. `Close()` on `Participant` and `PublishedTrack` both use `atomic.Bool.CompareAndSwap` so "who wins the race to close this" is answered exactly once regardless of caller. Matches the clean race-detector result.

**`go vet ./...` — clean, no output.**

**`go test -race -count=1 ./...`** — clean:
```
?    .../services/sfu/cmd/sfu           [no test files]
?    .../services/sfu/internal/config   [no test files]
?    .../services/sfu/internal/metrics  [no test files]
?    .../services/sfu/internal/registry [no test files]
ok   .../services/sfu/internal/room      58.984s
ok   .../services/sfu/internal/signal    2.460s
```
Coverage gap worth noting: `internal/metrics`, `internal/config`, `internal/registry` have **no test files at all**, so the clean race result says nothing about those packages.

### 3.2 Room ownership and scheduler — current behavior (SFU + control-plane, code-verified)

- **Can two SFUs accidentally own the same room?** From the SFU's own code alone: yes, nothing there would stop it — `Room`/`Manager.getOrCreateRoom` have no ownership check. In practice this cannot happen because the NestJS control plane's `RtcServerAllocatorService.allocate()` (`apps/api/src/modules/rtc-servers/rtc-server-allocator.service.ts:122-178`) does a conditional Postgres write — `updateMany({ where: { id: roomId, rtcServerId: null }, ... })` — so a losing concurrent allocator just re-reads the winner's choice. Two SFUs owning one room would require a control-plane bug in that conditional write; the SFU layer has no independent defense.
- **Where is ownership stored? Durable? Redis or Postgres?** Durable ownership is one column, `Room.rtcServerId`, in **Postgres**. Redis holds only an allocation *lock* (`raven:rtc:alloc:{roomId}`, 10s TTL) that the code's own comments describe as "an optimisation, not a correctness mechanism" — correctness rests entirely on the Postgres conditional write.
- **SFU crash:** missed heartbeat → `UNHEALTHY` after 30s; existing rooms stay pinned (not cleared) to the dead node; new joins get `RAVEN_RTC_SERVER_UNAVAILABLE` rather than being silently rerouted, because there is no migration mechanism to safely move them.
- **API crash:** stateless — any instance can serve any request; Redis/Postgres hold the shared state.
- **Redis unavailable:** allocation still works via the Postgres conditional write (more wasted-allocation risk, not a correctness loss). Separately, the SFU's 45-second node-link grace period keeps calls alive through a brief API-side blip regardless of cause.
- **Can a participant reconnect to the correct SFU?** Yes — reconnect re-runs `room.join`, which reads the room's untouched Postgres pin (`assignedServerFor`) and lands back on the same node.
- **Can a room migrate? Supported or intentionally unsupported?** **Intentionally unsupported**, confirmed at both layers. `rtc-server-allocator.service.ts:92-97` states it directly; `releaseRoom` only clears the pin when the room is already empty (never while live) — it is not a migration primitive, just a release. Both `docs/rtc/sfu.md` and `docs/rtc/scaling.md` state the same thing independently, and the code matches exactly what they claim: the abstraction (`assignedServerFor`/`releaseRoom`) exists, the renegotiation path does not.

### 3.3 Existing SFU metrics inventory vs. the target scheduler registry

| Target field | Status | Evidence |
|---|---|---|
| Rooms | EXISTS | `raven_sfu_active_rooms` (metrics.go:102-105) |
| Publishers / Subscribers | PARTIAL | `raven_sfu_active_participants` exists but is undifferentiated by role; track-kind counters (`active_audio_tracks`/`active_video_tracks`) exist but aren't participant-role counts |
| Health | PARTIAL | `raven_sfu_node_link_connected` exists (is a control plane attached) but not the richer HEALTHY/UNHEALTHY/DRAINING state, which lives only in the control plane's DB |
| CPU / Memory | EXISTS (better than the heartbeat's own numbers) | `process_cpu_seconds_total`, `process_resident_memory_bytes`, `go_memstats_heap_alloc_bytes` via the standard Prometheus Go/Process collectors. **Separately**, the heartbeat payload sent to the control plane carries its own `CPUPercent`/`MemoryPercent` that are Go-runtime GC-pause/heap approximations, not real host metrics (`registry/usage.go:30-54`) — a future scheduler should prefer the `/metrics` numbers over the heartbeat's approximated ones |
| Inbound / Outbound bitrate | EXISTS (outbound has a bug, see below) | `raven_sfu_media_bytes_received_total` / `_sent_total`, `rate()`-able |
| ID | MISSING as a metric label | Only present in structured logs (`cmd/sfu/main.go:207`), never exposed on `/metrics` |
| Region | MISSING entirely from `/metrics` | Known only at registration time (`registry/client.go:73`), sent to control plane, never exposed as a Prometheus label |
| Timestamp | MISSING as an explicit metric | Scrape timestamps cover this implicitly; no explicit "last active" gauge |

### 3.4 The non-monotonic outbound-bytes counter bug (confirmed)

`internal/metrics/metrics.go`, `trafficCollector.Collect()` :221-244. `raven_sfu_media_bytes_sent_total` (and packet-count siblings) is **not incremented in the forwarding path** — the real per-packet counters on `DownTrack` (`atomic.Uint64`, incremented in `WriteRTP`) are genuinely monotonic, but the exported metric is recomputed **at every scrape** by summing bytes across whatever `DownTrack`s currently exist. A `DownTrack` torn down between scrapes (unsubscribe/leave) is removed from the sum before its lifetime bytes are counted — so a churn burst can make the reported total go *down*, which is exactly the two implausible negative "outbound Mbps" samples seen in the soak test.

**Fix-safety assessment (assessment only — not implemented, per audit scope):** not a pure one-line fix, though contained. Correct shape: accumulate each `DownTrack`'s final byte/packet tally into a running node-level total **at teardown**, using the same `atomic.Bool.CompareAndSwap`-guarded exactly-once pattern already used elsewhere in this codebase for close paths (precedent exists — no new idiom needed) — plus still adding *live* downtracks' in-flight bytes at scrape time so the metric doesn't lag reality by a whole session length. Nothing else in the codebase depends on the current recompute-from-live-state behavior (the separate `Stats()` snapshot API used for `room.state` queries is structurally independent and unaffected). Net: safe to fix without touching hot-path locking, but needs a small design decision, not a mechanical rename.

---

### 3.5 Redis scalability inventory and findings

**Connection architecture.** One shared `ioredis` client per API instance (`RedisService`, `apps/api/src/shared/redis/redis.service.ts:8,27-45`; `commandTimeout: 2000ms`, `maxRetriesPerRequest: 3`), injected everywhere via a `@Global()` module. Three separate concerns each open their own `duplicate()`d subscriber connection off that client (ioredis subscriber mode is exclusive): `ChatEventsService`, `RoomEventsService` (RTC signaling), `ProjectOriginService` — so each API instance holds ~4 Redis connections, not 1.

**Key inventory (representative, not exhaustive):**

| Pattern | TTL | Owner | Ephemeral/Authoritative | Pub/Sub | Note |
|---|---|---|---|---|---|
| `raven:chat:events:{project}:{conv}` | n/a (channel) | `chat-events.service.ts` | Ephemeral fan-out | Yes | Ref-counted subscribe |
| `raven:presence:*`, `raven:typing:*` | 45s / 7s | `presence.service.ts`, `chat.constants.ts` | Ephemeral | No | High churn while typing |
| `raven:chat:ratelimit:{scope}:{project}:{subject}` | 10-60s window | `chat-rate-limit.service.ts` | Ephemeral | No | Fixed-window INCR+EXPIRE, fails open |
| `raven:chat:metrics:{project}:{metric}:{bucket}` | 2h | `chat-metrics.service.ts` | Ephemeral counters | No | **Hot-key risk** for one high-traffic project — every send/fanout/connect/reconnect/rate-limit event hits the same per-minute key |
| `raven:signaling:room:{roomId}:participants` / `:tracks` | 120s (2× heartbeat timeout) | `room-registry.service.ts`, `room-track-registry.service.ts` | Fleet-authoritative membership / SFU-cache | No | **Hot-key risk for large rooms**: `SignalingGateway.runHeartbeat` iterates local sessions *sequentially* (not batched) and EXPIREs each session's keys every 30s — a live-stream room now allowed up to 150 participants means ~150×3 serial EXPIRE round-trips per heartbeat tick on one instance |
| `raven:signaling:room:{roomId}:events` | n/a (channel) | `room-events.service.ts` | Ephemeral fan-out | Yes | Ref-counted subscribe |
| `raven:rtc:alloc:{roomId}` | 10s | `rtc-server-allocator.service.ts` | Best-effort lock only | No | Correctness does not depend on it |
| `raven:*:token:revoked:{jti}` (chat, RTC, dashboard) | token TTL | respective revocation services | Ephemeral tombstone | No | |

**rtc-servers registry is Postgres, not Redis or in-process.** `RtcServerRegistryService` upserts/updates every SFU node's row in Postgres directly (register/heartbeat/staleness-sweep all hit the same shared table) — survives any one API instance's restart and is fleet-consistent by construction. Redis appears here only as the allocation lock noted above.

**No Redis Cluster/Sentinel anywhere** — confirmed absent from `docker-compose.yml`, `docker-compose.scale.yml`, and every Azure script. Production Redis is a **single container physically co-located on the SFU VM** (`infrastructure/azure/06-deploy-sfu.sh`) — its fate is coupled to the media-plane VM's fate, not just a logical SPOF.

**Verdict: can the current Redis architecture survive multiple API replicas? YES**, with evidence: every fleet-wide-state call site uses Redis (or Postgres, for the one genuinely authoritative case — the rtc-servers registry) for coordination rather than treating any in-process state as authoritative; every Redis call site fails open except live fan-out itself (documented as going dark on a Redis outage). The single Redis node remains a real SPOF and eventual throughput ceiling (matches `CHAT_ROADMAP.md` §3/§8's own conclusion), but nothing found here contradicts that roadmap's own verdict that a single node is "very likely still sufficient" at 10K concurrent connections specifically.

---

### 3.6 TURN scalability audit

| Item | Current value | Source |
|---|---|---|
| Number of TURN servers | **1** (`raven-coturn-01`) | `infrastructure/azure/README.md`, `00-variables.sh` |
| VM size | `Standard_B2ats_v2`, 2 vCPU / 1 GB RAM | README.md |
| Relay port range | `49160-49200` (41 ports) | `turnserver.conf`, `07-deploy-coturn.sh` |
| Per-user / total quota | `user-quota=10`, `total-quota=400` | `07-deploy-coturn.sh:68-69` |
| Max bandwidth | `max-bps=1000000` (1 Mbps default) | `07-deploy-coturn.sh:70` |
| `external-ip` | **Present** in the committed Azure template (`external-ip=${TURN_PUBLIC_IP}/${TURN_PRIVATE_IP}`, `07-deploy-coturn.sh:41`, present since the script's original commit) | verified against git history |
| Health check | No continuous automated check — only a deploy-time log assertion and a manual `08-verify.sh` acceptance script | `07-deploy-coturn.sh:127-138`, `08-verify.sh` |
| Region | Single region (`eastasia`), no TURN-specific region tagging anywhere | README.md |

**The "NO EXPLICIT RELAY ADDRESS(ES)" / `10.10.1.5` / `172.17.0.1` / `::1` finding — reconciled.** The committed deploy template is correct as written (`external-ip` has always been set, not a later fix). The three observed addresses are internally consistent with coturn falling back to auto-detecting every local interface on the Azure VM specifically (`10.10.1.5` = that VM's real private IP; `172.17.0.1` = Docker's bridge gateway, implying host networking; `::1` = loopback) — exactly what happens when the explicit `external-ip` fails to take effect at runtime despite being correct in the file. This matches an **already-filed, still-open repo issue** (`docs/issues/05-coturn-fails-open.md`): coturn does not exit on a bad/unapplied config, it silently falls back to defaults with no realm, no auth, and no explicit relay address — and nothing currently *watches* the live relay address after deploy, only at deploy time. **Net: treat this as re-confirmation of an existing filed gap — continuous post-deploy TURN monitoring — not a new defect and not something to fix in this pass.**

**Gaps for multi-TURN / regional / health-checked / failover TURN:**
- Token minting hardcodes exactly one TURN host (`RtcTokensService` reads a single `turn.host` scalar; `turn-credential.util.ts` always builds the same 4 ICE server URLs against it) — no array of servers, no `TURN_REGION` equivalent to `SFU_REGION` anywhere in config validation.
- No TURN health state machine feeding allocation or credential minting (the SFU has a full HEALTHY/DRAINING/UNHEALTHY machine; TURN has nothing equivalent).
- Prometheus metrics exist in coturn (`--prometheus-port`) but are deliberately not exposed publicly in Azure and nothing in `apps/api` scrapes them.
- No failover: one VM, one hardcoded host — a coturn outage takes down every relay-dependent connection fleet-wide (5-15% of connections typically, 100% behind strict corporate firewalls, per `docs/rtc/networking.md`) with no fallback.

---

### 3.7 Live streaming scalability

Confirmed from `apps/api/src/modules/live-streams/live-streams.service.ts` and `services/egress-worker`: a live stream is one RTC Room + one Chat Conversation, tied together by a `LiveStream` row, with explicit compensating cleanup (not a DB transaction) if creation fails partway. `LiveStreamDeliveryMode.RTC_ONLY` vs `BROADCAST` is a real Prisma enum with real branching (viewer RTC tokens refused entirely for `BROADCAST`; egress only starts for `BROADCAST`). Egress is a headless-Chromium viewer running the real client SDK, piping decoded media into `ffmpeg` → HLS segments → blob storage, with a heartbeat/stale-sweep control loop on the API side and its own identity excluded from viewer counts. Cleanup on `end()` is race-safe (conditional `updateMany` guarded on `status: LIVE`) and closes the SFU session + publishes a Redis event so every gateway instance can notify its local participants; an *unclean* disconnect is still never detected server-side for live streams (documented gap, unchanged).

**Verdict: PARTIAL independence.** Participants-per-room **is** decoupled — live-stream rooms get a higher ceiling (`SIGNALING_MAX_PARTICIPANTS_PER_LIVE_STREAM_ROOM=150`) than ordinary rooms (`SIGNALING_MAX_PARTICIPANTS_PER_ROOM=50`), confirmed in `message-router.service.ts` and `configuration.ts`. But rooms-per-SFU-node is **not** decoupled — no live-stream-specific override of `SFU_ROOM_CAPACITY` exists, and live-stream rooms go through the exact same least-loaded allocator as ordinary call rooms. The universal one-room-one-node ceiling applies identically to live streaming; "10K concurrent users" for live streaming means many separate streams spread across many nodes, not one stream scaling past a single node's measured ceiling (50-100 viewers, per §2).

---

### 3.8 SDK reconnect/ICE concurrency safety

**A real cross-platform gap, found by this audit, not previously documented: the Flutter SDK implements all five hardening mechanisms; the Web SDK implements none of them.**

| Mechanism | Web SDK (`packages/sdk`) | Flutter SDK (`sdks/flutter/raven_rtc`) |
|---|---|---|
| Remote ICE candidate buffering | **Absent** — `raven-adapter.ts:798-821` calls `addIceCandidate` directly; a candidate that races ahead of the remote description is logged at debug and permanently dropped | **Present** — `engine.dart:534,720,734-738`, bounded ring buffer (max 128, drops oldest on overflow) |
| Candidate draining | **Absent** (nothing to drain) | **Present** — `engine.dart:774-786`, drains after remote description applies |
| ICE recovery watchdog (~12s) | **Absent** — no timers in the adapter at all; recovery is left entirely to the signaling client's reconnect trigger | **Present, exactly 12s** — `engine.dart:1592-1606` |
| One-shot ICE restart | **Absent** — no `restartIce` call anywhere in the Web SDK; recovery always falls through to a full re-join | **Present, correctly one-shot per connection generation** — `engine.dart:543-544,1621-1667`, explicit "deliberately not a retry loop" comment |
| Generation/epoch guards | **Absent** — no monotonic counter guarding stale async callbacks | **Present and thorough** — `_pcGeneration` (`engine.dart:517`), checked before and after every async step in the restart path, reset atomically in `resetPeerConnection` |

This is a correctness/robustness gap independent of scale (a single Web client's own overlapping reconnect attempts could race with no generation guard to stop it), not itself a fleet-scale amplifier — but it does mean Web clients are more likely to need a full "re-run the whole join" reconnect for failures a Flutter client could recover from in-place, which feeds directly into the thundering-herd math below.

**Thundering-herd verdict — 1,000 simultaneous reconnects: mitigates timing, not cost, and expected to overload documented capacity.** Every reconnect costs the same as a cold join by explicit design (`signaling-client.ts:78-87`: "more work than resuming a session, and it's the deliberate choice") — token validation, WS handshake, SFU allocation, fresh ICE/DTLS, full re-subscription. The first-attempt jitter window is only 300ms wide (`signaling-client.ts:293-296`), so 1,000 clients imply ~3,333 full-join attempts/sec of instantaneous demand at wave one — against a *measured* ceiling of 100 concurrent successful mints and 391.9-530.5 mints/sec sustained across 1-3 instances (`capacity.md:180-182`, `live-streaming-media-capacity.md:275-277`), and a *validated* 50-viewers-per-room ceiling. Expect a wave of `503 RAVEN_CAPACITY_EXCEEDED` on the opening burst, resolving over roughly a minute as the 12-attempt/up-to-10s backoff schedule spreads retries out — but the opening burst itself exceeds documented capacity.

**Thundering-herd verdict — 10,000 simultaneous reconnects: severe, near-certain capacity-exceeding event; the design amplifies rather than absorbs this scale.** Same math an order of magnitude up: ~33,333 full-join attempts/sec of instantaneous first-wave demand against ~400-530/s measured throughput (60-80× over) and a 200×-over per-room ceiling. Because every attempt costs full-join price up to the point of failure, a failed attempt doesn't degrade gracefully to something cheaper — it just gets retried at the same cost on the next backoff round, up to 12 times. The SFU's 45-second control-plane grace period only helps when PeerConnections themselves survive the triggering event (a pure control-plane blip); it does nothing for the case that actually forces mass reconnects — a mobile-tower handover or an SFU node restart, where the PeerConnections are what broke.

**Token-TTL reconnect-storm risk: real and unmitigated, confirmed by code.** `refreshToken` is a caller-supplied callback invoked only *reactively*, inside `scheduleReconnect`, on the first attempt or on an auth-failure close code (`signaling-client.ts:266-291`; Dart equivalent `signaling_client.dart:70,78`) — there is no timer keyed off the JWT's `exp` claim that proactively refreshes while the connection is healthy. `config.ts:75-92,108-111` decodes `exp` only to reject an already-expired token at construction; it's never used to schedule a future refresh. Consequence: expiry always means hard-disconnect-then-full-reconnect, and a cohort that joins together (e.g. everyone watching a popular stream's start) has tokens that expire together roughly one TTL later (600s default) — reproducing the exact same thundering-herd dynamics above, self-inflicted by TTL rather than triggered by a network event. This connects directly to the token-TTL gap `live-streaming-media-capacity.md:309` already flagged as a product decision, not an SDK defect: token refresh is explicitly the integrator's responsibility via the callback, and today nothing schedules it proactively on either platform.

### 3.9 Observability gap table

| Category | Metric | Status |
|---|---|---|
| API | requests/sec | EXISTS — `raven_http_requests_total`, `apps/api/src/modules/metrics/metrics.service.ts:51-56`, incremented at `shared/middleware/metrics.middleware.ts:43` |
| API | latency histogram | EXISTS — `raven_http_request_duration_seconds`, `metrics.service.ts:58-64` |
| API | errors | EXISTS (via `status` label incl. 4xx/5xx/429) — no dedicated error-only counter |
| API | active WebSockets | EXISTS — `raven_chat_connections_active`, `raven_signaling_connections_active`, `raven_dashboard_ws_connections_active` (`metrics.service.ts:95-163`) |
| API | reconnects | **MISSING** — no dedicated reconnect counter anywhere in chat/signaling/dashboard gateways |
| SFU | active rooms | EXISTS — `raven_sfu_active_rooms` |
| SFU | publishers | **MISSING** — `Manager.Load()` tracks combined participants/audio/video tracks only, no publisher-count field |
| SFU | subscribers | **MISSING** — same |
| SFU | CPU | EXISTS — `process_cpu_seconds_total` (standard Prometheus process collector) |
| SFU | memory | EXISTS — `process_resident_memory_bytes` / `go_memstats_heap_alloc_bytes` |
| SFU | goroutines | EXISTS — `go_goroutines` |
| SFU | RTP packets/sec | EXISTS (rate-derivable) — `raven_sfu_media_packets_received_total`/`_sent_total` |
| SFU | RTCP packets/sec | **MISSING** — RTCP is read/drained for feedback but not counted |
| SFU | inbound/outbound bitrate | EXISTS (rate-derivable; outbound has the non-monotonic bug from §3.4) |
| SFU | packet loss | **MISSING from Prometheus** — exists only in the signaling stats payload to the API/dashboard, not on `/metrics` |
| SFU | ICE failures | **PARTIAL/MISSING** — folded into generic `connections_failed_total` with no ICE-specific label |
| SFU | PeerConnection failures | EXISTS — `raven_sfu_connections_failed_total`/`_succeeded_total` |
| TURN | allocations / bandwidth / relay packets / relay failures / active sessions / port utilization | **Two different things, both now addressed, neither identical to this row's original ask.** (1) coturn's own detailed `--prometheus` exporter (the metrics this row originally asked about) is now enabled in production too, not just local dev (Phase 1, `07-deploy-coturn.sh`) — still nothing scrapes it, per §Phase1. (2) A control-plane-side up/down signal — `raven_turn_healthy{host}` / `raven_turn_health_check_failures_total{host}`, a real authenticated-Allocate probe, not coturn's own metrics — now exists too (Phase 4, `TurnHealthService`). Neither is per-allocation bandwidth/port-utilization detail; that still only exists inside coturn's own unscraped exporter. |
| Redis | commands/sec / latency / memory / connected clients | **ALL MISSING** — no `redis_exporter` anywhere in infra, no instrumentation in `redis.service.ts` |
| Postgres | connections / query latency / transactions / locks / slow queries | **ALL MISSING** — no `postgres_exporter`, no Prometheus wiring in `prisma.service.ts`, no `$on('query')` hook |

No `prometheus.yml` or Grafana config exists anywhere in the repo, so even the EXISTS rows above are confirmed only as *emitted by the code*, not confirmed as scraped/dashboarded in production.

**The Guards-before-Interceptors RED-metrics fix (from `capacity-report.md` §4) is confirmed still in place, no regression.** `MetricsMiddleware` (`shared/middleware/metrics.middleware.ts:11-44`) runs as Express middleware — ahead of Nest's Guards/Interceptors/Pipes — wired via `app.module.ts:113-120` (`consumer.apply(RequestLoggerMiddleware, MetricsMiddleware).forRoutes('*')`), and records on `res.on('finish', ...)` so it captures the final status code regardless of which guard rejected the request. No `MetricsInterceptor` class exists anywhere in current `apps/api/src` (confirmed by repo-wide grep) — the old broken pattern has not been reintroduced.

### 3.10 CI/CD deployment audit — the GHCR/ACR question, resolved for API, still open for SFU

**API image pipeline: RESOLVED, not broken.** `docker-publish.yml`'s `deploy-azure` job runs automatically on every push to `main` (`needs: build`, gated only on Azure credentials being present). Promotion is **digest-based, not a rebuild**: `docker buildx imagetools create` copies the already-built, already-scanned GHCR manifest straight into ACR under both the immutable `github.sha` tag and `:latest` — so the deployed bytes are exactly the scanned bytes, no re-build step to drift. Steps run strictly sequentially under `set -euo pipefail` (login → promote → migrate → `az containerapp update --image ...:${{ github.sha }}` → health check), and the Container App is pinned to the **immutable sha tag**, not `:latest` — so there is no race window where a deploy could pull a half-promoted `:latest`. Residual risk is confined to the **manual/local operator path** only (`09-api-image.sh`/`13-api-app.sh`, which still default to the mutable `RAVEN_IMAGE_TAG=latest`) — the CI path sidesteps this entirely.

**SFU image pipeline: the registry mismatch is REAL and CURRENTLY UNADDRESSED.** `sfu-publish.yml` only pushes to GHCR (`ghcr.io/atulsinghhhh/raven-sfu`) — it has no Azure/ACR job at all, unlike the API's workflow. But the actual SFU deploy script (`infrastructure/azure/06-deploy-sfu.sh`) pulls from **ACR**, defaulting to the same mutable `RAVEN_IMAGE_TAG=latest`. There is no script anywhere in the tree that pushes the SFU image into ACR — no SFU equivalent of `09-api-image.sh` exists. This is a genuine, currently-open gap requiring an undocumented manual step, and it is the one place the audit brief's original claim ("CI pushes to GHCR, deploy pulls from ACR") is accurate today.

**Rollback: documented and scripted for the API, absent for the SFU.** `infrastructure/azure/README.md`'s "Rollback" section gives two paths (traffic-shift to a known-good Container App revision; `az containerapp update --image ...:<older-sha>`, viable because CI's sha tags are immutable) plus an explicit caveat that rollback never reverts the database (migrations are forward-only). No equivalent exists for the SFU — `06-deploy-sfu.sh` is a plain `docker compose up -d` on one VM, with no revision concept and no rollback script.

**`RAVEN_IMAGE_TAG` default-`latest` immutability risk — still live for two of three deploy paths.** Mitigated (irrelevant) for the API's CI-driven path, since CI deploys by digest and never reads this variable. Still fully live for the manual/local API deploy scripts, and for the **entire SFU deploy path**, since neither has a digest-pinning promotion step analogous to `imagetools create`. A build and a later independent deploy running by hand can still silently disagree about which image "latest" means.

---

### 3.11 API horizontal scalability findings (verified directly against `apps/api/src`)

**Verdict: API-1/API-2/API-3 can serve the same customer simultaneously — YES**, for every major flow checked, with one deliberate, safe exception.

| # | File:Line | Finding | Classification | Severity | Notes |
|---|---|---|---|---|---|
| 1 | `modules/signaling/rooms/room-registry.service.ts:41-90` | `RoomRegistryService` holds a local `Map<string, Map<string, ParticipantSession>>` of sockets *this instance* physically holds, plus a Redis-backed fleet view (`SignalingRedisKeys.roomParticipants`, TTL'd, re-armed every heartbeat) for cross-instance membership. Fails open to the local-only view on a Redis read error rather than refusing joins fleet-wide. | **Correct design, not a defect** — this is exactly the split `docs/rtc/scaling.md` describes, confirmed present in code | — | The local map is necessary (only the holding process can write to its own socket); nothing here blocks horizontal scaling |
| 2 | `modules/chat/gateway/connection-registry.service.ts` | Same pattern for chat: local session/room-index maps + Redis-mediated cross-instance fan-out (`ChatEventsService`) | Correct design, confirmed present | — | Matches `CHAT_ARCHITECTURE.md` §1 exactly |
| 3 | `modules/rtc-servers/rtc-server-registry.service.ts`, `prisma/schema.prisma:879-907` (`RtcServer` model) | The rtc-servers registry (node id, region, status, capacity, `activeRooms`/`activeParticipants`, heartbeat timestamp) is a **Postgres table**, not Redis and not in-process. Every instance reads/writes the same rows. | Correct design | — | Survives any one instance's restart; fleet-consistent by construction |
| 4 | `modules/rtc-servers/rtc-server-allocator.service.ts` | Room-to-node assignment uses a Redis lock (`raven:rtc:alloc:{roomId}`, 10s TTL) as an *optimization only* — real correctness comes from a conditional Postgres `updateMany({ where: { id: roomId, rtcServerId: null }, ... })`, so a losing concurrent allocator on another instance just re-reads the winner's choice | Correct design, race-safe by construction | — | Matches the SFU audit's independent finding on room ownership |
| 5 | `modules/api-keys/api-keys.service.ts:52-92` | `ApiKeysService.verifiedSecrets` is a **process-local** `Map<string, VerifiedSecret>` caching only the expensive bcrypt comparison result (never the authorization decision — key status is re-read from Postgres on every request, so revocation is still immediate). Bounded (`apiKeyCache.maxEntries`, default 5000) and TTL'd (`apiKeyCache.ttlSeconds`, default 60s). Explicitly documented in-code as "process-local, not Redis" by design, since a Redis round-trip would cost more than the 75ms it saves. | **Deliberate, safe process-local cache** — the one place per-instance state exists, and it's the intentional exception, not an oversight | Low (informational) | Correct behavior: each instance independently warms its own cache; a cold instance is briefly slower, never incorrect |
| 6 | `modules/api-keys/api-keys.service.ts:4` | Confirms `capacity.md`/`capacity-report.md`'s bcrypt finding is only **half-fixed**: the verify-cache exists exactly as those docs describe, but the dependency is still `bcryptjs` (pure-JS, blocks the event loop), not switched to native `bcrypt`. The ~75ms-per-uncached-comparison cost is unchanged; the cache just makes most requests skip it. | Confirms prior finding still accurate | Medium | A cold cache (first request per key per TTL window, or a fleet-wide restart) still pays the full per-process ~13 req/s ceiling until warmed |
| 7 | `modules/rooms/rooms.service.ts:120-124` (`findAllForProject`) | Unbounded `prisma.room.findMany` with no `take`/pagination — returns every ACTIVE room for a project/environment in one response | Real finding, not previously documented | Medium | Grows linearly with a project's room count over time; not a per-connection hot path (it's a listing endpoint), so it's a data-growth risk rather than a concurrent-user scaling risk directly — flag for pagination before a project accumulates thousands of rooms |
| 8 | Background jobs — `chat-retention.service.ts`, `webhook-delivery.worker.ts` | Both explicitly acquire a Redis lock before their sweep, because their side effects (batch deletes, webhook sends) are not naturally safe to duplicate across instances | Correct design | — | |
| 9 | Background jobs — `usage-meter.service.ts` reaper, `live-streams.service.ts` `reapOverdueStreams`, `rtc-server-registry.service.ts` stale-sweep, all gateway heartbeat sweeps (`signaling.gateway.ts`, `chat.gateway.ts`, `dashboard-ws.gateway.ts`) | All run independently on **every** replica via plain `setInterval`, with **no lock** | Correct by a different mechanism: each one's underlying write is naturally idempotent/conditional (`startSession` keyed on unique `sessionKey`, find-then-create; `reapOverdueStreams` reuses `end()`'s conditional `updateMany` guarded on `status: LIVE`; the stale-sweep only moves a node whose heartbeat deadline has already passed) | — | N replicas racing costs N redundant reads and, at most, one real write plus N−1 harmless no-ops — not a correctness bug, matches `docs/rtc/scaling.md`'s explicit claim about the stale-sweep specifically, now confirmed to hold for the other four sweeps too |

**No package-level mutable state, no in-memory rate limiting, and no other in-process caches were found** beyond the one deliberate exception above (repo-wide grep for module-scope `Map`/`Set`/array literals outside a class body, across `apps/api/src`, turned up nothing else holding request-serving state).

### 3.12 Postgres findings

Schema: `apps/api/prisma/schema.prisma`, 1150 lines, 34 models. Pool: `shared/database/prisma.service.ts:26` — `max: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10)`, confirming `docs/deployment/managed-postgres.md`'s description exactly (Supabase-managed, transaction pooler on `:6543`, `N instances × DATABASE_POOL_MAX` is the real ceiling against Supabase's project connection limit).

| # | File:Line | Finding | Severity | Recommended change |
|---|---|---|---|---|
| 1 | `schema.prisma:572-603` (`Message`/`chat_messages`) | **Confirmed still open**: `CHAT_ROADMAP.md` §5's flagged missing composite index `[conversationId, senderId, createdAt]` is genuinely absent. Current indexes are `[conversationId, createdAt, publicId]`, `[senderId, createdAt]`, `[threadRootId, createdAt]` — none serve a "this sender's messages in this conversation, in order" query in one index | Medium | Add the composite index if that query pattern exists (per-sender history within a conversation); otherwise re-confirm it's genuinely unneeded before adding write overhead to the hottest table in the schema |
| 2 | `schema.prisma:339-361` (`Room`) | Well-indexed for its access patterns: `[projectId, environment, name]` unique, `[projectId]`, `[rtcServerId]` | — | None needed |
| 3 | `schema.prisma:879-907` (`RtcServer`) | `[region, status]` index matches the allocator's exact query shape (least-loaded healthy node in a region) | — | None needed |
| 4 | `modules/rooms/rooms.service.ts:120-124` | Unbounded `findMany`, no pagination — see §3.11 finding 7 | Medium | Add `take`/cursor pagination |
| 5 | `modules/chat/messages/messages.service.ts:324,404,417,591` | All four `Message.findMany` call sites use explicit `take` limits (`take: limit + 1` pattern for cursor pagination) — the chat surface is disciplined about bounding queries | — | None needed |
| 6 | `modules/live-streams/live-streams.service.ts:224` (`reapOverdueStreams`) | Bounded (`take: 500`) even though it's a background sweep, not a request path | — | None needed — good practice already followed |
| 7 | `modules/api-keys/api-keys.service.ts` `verify()` | Reads the key's row from Postgres on **every** request (by design, for immediate-revocation correctness — see §3.11 finding 5), but this is a single indexed `findUnique` by `publicId` (unique-indexed), not a scan — cheap, not a hot-path N+1 risk | — | None needed |
| 8 | No connection-pool exhaustion evidence found | The pool ceiling is `N × 10` by config; nothing in the code raises it dynamically or pools per-request | — | Confirms `docs/rtc/scaling.md`'s own recommendation: a PgBouncer-style pooler (already provided by Supabase) is the right lever once instance count makes `N × 10` tight against the project's real connection ceiling — not yet measured at what instance count that becomes tight (Supabase plan-tier-dependent; genuinely UNKNOWN without knowing the target deployment's Supabase tier) |

**Does Postgres become a bottleneck at 1K/5K/10K concurrent users? UNKNOWN, with a specific reason, not a guess.** No DB call was found on a genuinely hot per-packet or per-message-fanout path (chat's realtime delivery goes through Redis pub/sub, not a DB write per fan-out; the SFU's media path has zero DB calls per the SFU audit). The actual constraint is **connection-count arithmetic**, not query cost: `N_instances × DATABASE_POOL_MAX(=10)` must stay under whatever `max_connections`-equivalent ceiling the deployment's specific Supabase project tier enforces, and that tier is not specified anywhere in the repo (it's a deployment choice, not a code fact). **Benchmark required**: the actual Supabase project tier's connection ceiling, and a measurement of how many API instances that ceiling supports before requiring either a higher `DATABASE_POOL_MAX`-to-tier ratio or Supabase's own pooler scaling — this is an infrastructure/billing fact this audit cannot read out of the repository.

### 3.13 Scalability scorecard

Classified as **READY** (proven, horizontally scalable today), **PARTIAL** (scales in one dimension, blocked or unproven in another), **BLOCKED** (a real, identified ceiling exists), or **UNKNOWN** (no evidence either way, benchmark specified). No entry below is invented — each links back to the subsection that produced it.

| Subsystem | Current state | Horizontal scaling | Main bottleneck | Evidence | Required work |
|---|---|---|---|---|---|
| **API** (`apps/api`) | READY | READY — no process-local state blocks it beyond one deliberate, safe cache | `bcryptjs` still blocks the event loop on a cache-cold request | §3.11; `capacity-report.md` §1.3 (94.7% 2-instance efficiency) | Phase 0: swap to native `bcrypt` |
| **Postgres** (Supabase) | READY at measured scale | READY, bounded by `N × DATABASE_POOL_MAX` against a **now-measured** ceiling for this project (`max_connections=60`, ~6 already consumed by Supabase's own platform services) — Phase 5 | Connection-count arithmetic, not query cost — no hot-path DB calls found anywhere | §3.12, Phase 5 | Confirm Supavisor's own pooler-side pool size (needs dashboard access this session lacked) to refine the ceiling further |
| **Redis** | PARTIAL | READY for correctness (every fleet-wide state read is Redis/Postgres-backed, fails open) | Single node, co-located with the SFU VM — real SPOF, shared fate | §3.5, Phase 5 | Decouple from SFU VM — **blocked on an operator decision, not code**: a dedicated 3rd VM competes with Phase 3/4's own VM-quota headroom (2 vCPUs total available for all three); Azure Cache for Redis avoids that conflict but is unverified. Sentinel only once volume demands it |
| **SFU** (`services/sfu`) | PARTIAL | **PARTIAL** — allocator now validated against 2 real live processes locally (Phase 3); only 1 node has ever been deployed to real Azure infrastructure | Cross-node allocation mechanism itself is confirmed working; true per-node ceiling above 125 viewers is still unknown, and the Azure-specific network path is unvalidated | §2, §3.1-§3.3, Phase 3; `architecture-5k.md` §2 | Repeat Phase 3's validation against 2 real Azure VMs once the subscription is reactivated |
| **TURN** (coturn) | PARTIAL | PARTIAL — token minting now returns a server list (verified against 2 real coturn nodes locally) and a continuous health signal exists; production is still exactly one VM | No 2nd *production* node yet (config-plumbing to add one is ready, unverified against live Azure); relay bandwidth under real concurrent load never tested at any scale | §3.6, Phase 4 | Deploy a real 2nd coturn VM once the Azure subscription is reactivated; then a relay-bandwidth benchmark |
| **Signaling** (RTC WS gateway) | READY | READY — local socket maps + Redis-mediated fleet membership, verified in code | None found — correctly designed | §3.11 finding 1-2; `docs/rtc/scaling.md` | None required |
| **Chat** | READY | READY — same pattern as signaling, independently confirmed sufficient for 10K by the project's own roadmap | Single Redis node (shared with the risk above) | §3.5; `CHAT_ROADMAP.md` §10 ("handles this with modest changes") | None required at 10K; Redis Cluster only past ~100K |
| **Live streaming** | PARTIAL | PARTIAL — `BROADCAST` mode scales independently via real HLS egress code; `RTC_ONLY` mode is bounded exactly like a normal call room | `RTC_ONLY` inherits every SFU-node ceiling above; `BROADCAST` egress throughput has zero benchmark evidence | §3.7 | Benchmark `BROADCAST`-mode egress/CDN throughput separately |
| **SDK** (Web + Flutter) | PARTIAL | PARTIAL — Flutter has full ICE-resilience hardening; Web SDK has none of it | Every reconnect costs a full cold join with no adaptive throttling for mass-reconnect events | §3.8 | Port the 5 mechanisms to the Web SDK (blocker 7); no server-side fix exists for reconnect-cost amplification yet |
| **CI/CD** | PARTIAL | READY for `apps/api` (digest-based GHCR→ACR promotion, immutable-tag deploy, health-gated) — **BLOCKED for `services/sfu`** (no promotion step, no rollback script) | The SFU's actual production image bypasses CI's scan/test gates entirely | §3.10 | Add an SFU equivalent of `imagetools create` + a rollback script |
| **Observability** | PARTIAL | READY for API/SFU (solid `/metrics` coverage, a few real gaps) — **BLOCKED for TURN/Redis/Postgres** (zero production metrics for all three) | Three of five infrastructure layers are invisible to any dashboard; no `prometheus.yml`/Grafana config exists anywhere | §3.9 | Phase 1: enable coturn's exporter, add `redis_exporter`/`postgres_exporter` |

---

## 4. Current bottlenecks, consolidated

Ranked by how directly each one blocks concurrent-user scaling, not by discovery order.

1. **Single *production* coturn VM, no failover** (§3.6, Phase 4). 5-15% of all connections need TURN, 100% behind strict corporate firewalls; one relay-bandwidth-bound VM serving 10,000 concurrent users' relay share has never been sized or load-tested. The token-minting-side blocker (no way to hand clients more than one host) is fixed and verified against 2 real local coturn nodes — the remaining gap is deploying an actual second production VM, blocked by the same disabled Azure subscription as Phase 3.
2. **Single Redis node, co-located on the SFU VM** (§3.5, Phase 5). Currently survives multiple API replicas correctly (verified), but is a real SPOF: losing it stops chat/signaling real-time fan-out fleet-wide, and it shares fate with the media-plane VM rather than failing independently. **Decoupling is blocked on a real resource conflict, not just the disabled subscription**: this subscription's Basv2 VM-family regional quota has exactly 2 vCPUs of headroom — enough for a dedicated Redis VM, a 2nd SFU node, or a 2nd TURN node, but not more than one of the three without a quota increase.
3. **`bcryptjs` still blocks the Node event loop; the cache only hides it, doesn't fix it** (§3.11 findings 5-6). A cache-cold burst (fleet restart, or a burst of never-before-seen keys) still hits the ~13 req/s-per-process ceiling `capacity-report.md` measured.
4. **Multi-node SFU allocation — validated locally in Phase 3, not yet on real production infrastructure.** Only one SFU node has ever been deployed *to Azure* (`architecture-5k.md` §2), and that remains true — the subscription backing it is currently disabled. But the mechanism itself is no longer unknown: Phase 3 ran two real, independent SFU processes locally and confirmed the allocator's live behavior matches what `rtc-server-allocator.service.spec.ts` already asserted against mocks (real conditional-write assignment, real per-node dispatch, real release-on-empty). What remains genuinely open is production-specific: VM-to-VM networking, NSGs, and the real `SFU_PUBLIC_IP`/ICE-candidate path, none of which a local test exercises. Re-run the same validation against two real Azure VMs once the subscription is reactivated.
5. **No load-generation rig capable of producing more than a few hundred independent real viewers** (§2, `architecture-5k.md` §4). Every number above ~125 viewers requires distributing the harness across multiple machines first; this is a testing-infrastructure gap that blocks *validating* any fix to bottlenecks 1-4, not a product defect itself.
6. **Web SDK lacks the ICE resilience mechanisms the Flutter SDK has** (§3.8). Not a fleet-load amplifier by itself, but raises the rate at which Web clients need a full (expensive) reconnect instead of a cheap in-place recovery — which feeds bottleneck 7.
7. **Every reconnect costs as much as an original join, by design, with no adaptive throttling for mass-reconnect events** (§3.8). A shared-cause disconnection (SFU node restart, mobile-tower handover affecting many users, or a synchronized token-TTL expiry) turns into a load spike sized like a wave of fresh joins, not a cheap resume — and jitter only spreads the *retry* timing, not the *triggering* disconnect.
8. **No observability for TURN, Redis, or Postgres in production, and partial gaps in SFU metrics** (§3.9). An incident in any of these three today would be diagnosed by log-reading, not dashboards — this doesn't cause an outage, but multiplies the time to find one at any scale.
9. **SFU image has no ACR promotion path; no rollback script for the SFU** (§3.10). Operationally this means a bad SFU release cannot be rolled back the way the API can, and there's an undocumented manual step to get a new SFU build into the production registry at all.
10. **Non-monotonic outbound-bytes metric** (§3.4). Cosmetic today (loss% stayed 0.00% throughout the incident that exposed it), but would mislead a `rate()`-based dashboard alert during ordinary churn once one exists.

## 5. Scaling risks (forward-looking, not yet observed)

- **Connection-count arithmetic against an unspecified Supabase tier** (§3.12) — the single biggest "we don't actually know" in the whole audit; every other Postgres finding is clean.
- **A hot key or hot room's serial-EXPIRE heartbeat cost** (§3.5) — `SignalingGateway.runHeartbeat` iterating local sessions sequentially means a live-stream room's raised 150-participant ceiling multiplies one instance's per-tick Redis round-trips linearly; not yet a measured problem, but the shape of one.
- **`Message` table growth with `CHAT_RETENTION_DAYS` defaulting to keep-forever** (`CHAT_ROADMAP.md` §5 item 5, unchanged) — a real customer running sustained traffic without setting retention will eventually need the partitioning `CHAT_ARCHITECTURE.md` §2 already scopes as conditional future work.
- **Simulcast keyframe detection is VP8/VP9/H.264-only** (`docs/rtc/sfu.md`) — AV1/H.265 publishers silently lose adaptive quality under load; not a concurrency bottleneck, but a quality cliff that gets more visible as more participants join with those codecs.
- **No congestion control (TWCC collected, never consumed)** (`docs/rtc/scaling.md` known gaps) — under real-world network stress at any scale, degrading connections see packet loss instead of an automatic layer downgrade; this makes "10K users, mixed network quality" look worse than "10K users, uniform good network," a gap this audit's clean-loss-at-every-tested-tier benchmarks cannot see because they were run on uncongested loopback/LAN paths.

## 6. Failure scenarios — current behavior

| Scenario | Current behavior | Evidence |
|---|---|---|
| **API instance dies** | No impact beyond its own in-flight requests and sockets. Clients reconnect (full rejoin) and land on any surviving instance; room/chat membership is Redis/Postgres-backed, not lost. | §3.11; `docs/rtc/architecture.md` "Restart cost: None — clients reconnect" |
| **SFU dies** | Every call on that node drops immediately (no live-call migration exists). New joins to rooms that *were* on it fail with `RAVEN_RTC_SERVER_UNAVAILABLE` until the node comes back or the (now-empty) room is released and reallocated. With only one SFU node deployed today, this is a full media-plane outage, not a partial one. | §3.2, §2; `capacity.md` "Known architectural limits" |
| **TURN dies** | Every connection that needed a relay (5-15% typically, up to 100% behind strict firewalls) loses connectivity with no fallback — one coturn VM, no second node. Direct-path connections are unaffected. | §3.6 |
| **Redis dies** | Room-join allocation still works (correctness lives in Postgres's conditional write); RTC signaling falls open to each instance's local-only participant view (a join still succeeds, cross-instance visibility degrades); chat real-time fan-out **goes dark** (the one documented exception to "fails open"); rate limiting and token revocation checks fail open (available but unenforced) rather than blocking requests. | §3.5, §3.11 finding 1; `CHAT_ARCHITECTURE.md` §1 |
| **Postgres (Supabase) unavailable** | New room/participant/message writes fail; existing SFU media sessions are unaffected (zero DB calls on the media path, confirmed by the SFU audit); existing signaling/chat connections continue running on whatever fleet-wide Redis state is already cached, but any new join or new message send fails loudly. | §3.12; SFU audit's confirmation of zero DB calls on the packet-forwarding path |
| **Network partition (API ↔ SFU node link)** | The node keeps every existing call running for a **45-second grace period** regardless of cause; `/healthz` deliberately ignores link state so the node doesn't fail its own liveness probe and get killed mid-call. New rooms can't be allocated to a partitioned node during the partition. | `docs/rtc/architecture.md` "Reconnection" section |
| **Client changes network (Wi-Fi ↔ cellular)** | Treated identically to any other disconnect: full reconnect, fresh PeerConnection, fresh node allocation, deliberately — the docs explicitly reject session-resumption here as less reliable than starting clean for a genuinely different network path. | `docs/rtc/architecture.md` "Reconnection" |
| **1,000 users reconnect simultaneously** | Jittered backoff (300ms→10s, 12 attempts) spreads *retry* timing but not first-attempt cost; ~3,300 full-join-cost attempts/sec of instantaneous first-wave demand against a measured ~400-530 mints/sec ceiling and a validated 50-viewer-per-room limit. Expect a `503 RAVEN_CAPACITY_EXCEEDED` wave on the opening burst, resolving over roughly a minute as backoff spreads retries. | §3.8 (verified by the SDK audit) |
| **10,000 users reconnect simultaneously** | Same dynamic, an order of magnitude worse: ~33,000 attempts/sec of first-wave demand, 60-80× over measured control-plane throughput, 200× over the validated per-room ceiling. No cheaper degraded-mode exists — every attempt costs full-join price up to its failure point, and failures get retried at the same cost. This is the audit's clearest "will not survive un-mitigated" finding. | §3.8 |

**Cascading-failure risk, stated plainly:** the two findings above compose. A single-node SFU or single coturn-VM failure (bottlenecks 1 and 4 in §3) is exactly the kind of shared-cause event that triggers a mass-reconnect wave (failure scenario above) — and that wave's cost is sized like thousands of fresh joins hitting a control plane whose own measured ceiling is in the low hundreds of req/s. The individual pieces (SFU failure handling, reconnect backoff, admission control) are each reasonable in isolation; the audit's most important finding is that they have not been evaluated *together* under the specific shared-cause-disconnect shape that a real single-SFU-node deployment would actually produce.

## 7. Observability gaps

See §3.9 for the full metric-by-metric table. Summary: API and SFU have solid coverage with a few real holes (reconnect counts, per-role publisher/subscriber counts, RTCP packet rate, SFU-side packet-loss on Prometheus). TURN, Redis, and Postgres have **no production metrics at all** — three of the platform's five infrastructure layers are currently invisible to any dashboard, and would be diagnosed via logs alone during an incident.

## 8. Top 10 blockers, ranked by technical dependency

Ordered so that fixing #1 doesn't require #2-10, but several later items depend on earlier ones being addressed first to be safely measurable.

| # | Blocker | File/Area | Failure mode | Minimum fix | Backward compatible? | Migration needed? | Benchmark needed | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | Load-generation rig is single-machine, caps real testing at ~125 viewers — **the harness itself is now containerized and distributed (Phase 6)**, verified at 30 real viewers across 3 containers; what's still missing is a real fleet to point it at and a second physical host to prove genuine cross-machine distribution | `scripts/capacity/` | Every number above this audit's tested tiers is unmeasured, not "not yet reached" — blocks validating fixes to #2-5 | Run `coordinate.mjs` against a real multi-node fleet once one exists; add a `--context` worker on a real second host to prove distribution, not just containerization | Yes | No | This *is* the benchmark-infrastructure work | Low technical risk — the remaining work is infrastructure access (a fleet, a second host), not more engineering |
| 2 | Multi-SFU allocation — **locally validated in Phase 3** (real conditional-write assignment, real dispatch, real release, confirmed against 2 live local processes); still not exercised against real Azure infrastructure | `rtc-server-allocator.service.ts`, `services/sfu` | Locally resolved. Remaining unknown is narrower and Azure-specific: VM-to-VM networking, NSGs, real `SFU_PUBLIC_IP` — not the allocation logic itself | Repeat the same validation against 2 real Azure VMs once the subscription (currently disabled) is reactivated | Yes | No | 2-node live allocation test on real Azure VMs | Low-Medium — downgraded from Medium now that the allocation mechanism itself has real-process evidence, not just mocks |
| 3 | Single *production* coturn VM, no failover, capacity never load-tested — the token-mint-side list-of-servers gap is **fixed and verified** (Phase 4) | `infrastructure/azure/07-deploy-coturn.sh` | TURN outage takes 5-100% of connections down fleet-wide with no fallback; relay bandwidth at real concurrency is unknown | Deploy a second real production TURN node — config plumbing for it is ready (`RAVEN_TURN_EXTRA_VMS`/`RAVEN_TURN_EXTRA_IP_NAMES`, unverified against live Azure) | Yes — already additive, and now shipped | No | TURN relay bandwidth under real concurrent-allocation load, once a 2nd production node exists | Low-Medium — downgraded from Medium now that the harder half (client-facing multi-host support + a real health signal) is done and verified |
| 4 | Single Redis node, co-located with the SFU VM | `infrastructure/azure/06-deploy-sfu.sh` | Redis loss takes down chat/signaling real-time fan-out fleet-wide and is coupled to the media VM's own fate | Move Redis off the SFU VM — **recommend Azure Cache for Redis over a dedicated VM**, specifically because a 3rd VM competes with Phase 3/4's own scaling plans for the same 2-vCPU quota headroom and a managed service doesn't; Sentinel/Cluster only once volume actually approaches one node's ceiling (`CHAT_ROADMAP.md` §8 explicitly says not preemptively) | Yes | Minimal (connection string change — confirmed: `redis.service.ts` is already fully topology-agnostic) | None required for the decoupling step itself | Low (mechanically), but genuinely blocked on an operator's own choice between the two paths, not just the subscription |
| 5 | `bcryptjs` still blocks the event loop; cache only hides it | `modules/api-keys/api-keys.service.ts:4` | Any cache-cold burst (fleet restart, novel keys) still hits ~13 req/s/process | Switch to native `bcrypt` (thread-pool-based) | Yes, drop-in | No | Re-run `capacity-report.md`'s exact test post-fix | Low |
| 6 | Reconnect cost equals full-join cost, no adaptive throttling for mass events | SDK signaling clients (both platforms) + API admission control | A shared-cause disconnect (bottleneck 2 or 3 above failing) produces a load spike sized like thousands of fresh joins against a control plane rated in the low hundreds of req/s | Server-side: ensure `RAVEN_CAPACITY_EXCEEDED`/`RAVEN_RATE_LIMITED` responses are cheap to produce even fully loaded (verify, don't assume); client-side: consider whether the SDK's reconnect jitter window should scale with observed fleet-wide reconnect volume rather than a fixed 300ms — this is a design question, not a one-line fix | Needs care — client-visible timing change | No | The 1,000/10,000-simultaneous-reconnect scenario, run for real once #1 exists | Medium-high — the audit's clearest "won't survive as-is" finding |
| 7 | Web SDK missing candidate buffering/watchdog/restart/generation-guards that Flutter has | `packages/sdk/src/internal/sfu/raven-adapter.ts` | Web clients need a full reconnect for failures Flutter clients recover from in-place, indirectly feeding blocker 6 | Port the 5 mechanisms from `sdks/flutter/raven_rtc/lib/src/internal/engine.dart` to the Web SDK adapter | Additive, no public API change needed | No | Reconnect-rate comparison, Web vs. Flutter, under identical induced network flakiness | Medium |
| 8 | No TURN/Redis/Postgres production metrics | infra-wide | An incident in any of these three is diagnosed via logs, multiplying time-to-detect/resolve at any scale | Enable coturn's `--prometheus` in production config; add `redis_exporter`/`postgres_exporter` | Yes | No | None — this is instrumentation, not a benchmark | Low |
| 9 | SFU image has no ACR promotion or rollback path | `sfu-publish.yml`, `infrastructure/azure/06-deploy-sfu.sh` | A bad SFU release has no scripted rollback, unlike the API; getting a new build into production ACR requires an undocumented manual step | Add an SFU equivalent of the API's `imagetools create` promotion step + document/script a rollback | Yes | No | None | Low-medium (operational risk, not a scaling one) |
| 10 | Non-monotonic outbound-bytes metric | `services/sfu/internal/metrics/metrics.go:221-244` | Would produce false-looking drops on a future `rate()`-based dashboard during ordinary churn | Accumulate final byte tally at DownTrack teardown into a running total, add live in-flight bytes at scrape time | Yes | No | None | Low |

## 9. Phased implementation roadmap

Each phase lists files, tasks, tests/benchmarks, and rollout/rollback — scoped to what §3/§7 actually found, not speculative work.

### Phase 0 — Correctness (no user-facing change) — **DONE**

- **Files**: `services/sfu/internal/metrics/metrics.go` (non-monotonic counter, blocker 10); `modules/api-keys/api-keys.service.ts` (bcrypt→native, blocker 5); `modules/rooms/rooms.service.ts` (pagination, §3.11 finding 7).
- **Tasks**: fix the outbound-bytes counter to accumulate-at-teardown; swap `bcryptjs`→`bcrypt`; add `take`/cursor pagination to `findAllForProject`.
- **Tests**: existing `go test -race ./...` (already clean — re-run after the metrics fix); re-run `capacity-report.md`'s §1 REST benchmark after the bcrypt swap and confirm the ~13 req/s ceiling moves by the 1-2 orders of magnitude predicted.
- **Rollout/rollback**: all three are drop-in, low-risk; standard deploy, no feature flag needed; rollback is a plain revert.

**What actually shipped, with evidence:**

1. **Non-monotonic SFU byte/packet counters (blocker 10) — fixed.** New file `services/sfu/internal/room/traffic_totals.go`: a package-level, atomic-only accumulator (`closedTrackTraffic`) that banks each `PublishedTrack`'s and `DownTrack`'s final byte/packet tally exactly once, at `Close()` — guarded by the existing `CompareAndSwap`-on-`closed` idiom (added the same guard to `DownTrack.Close()`, which previously used a bare `Store(true)`). `metrics.go`'s `trafficCollector.Collect()` now adds `room.ClosedTrafficTotals()` to its live-tracks sum, so a churn burst can no longer make the exported counter go backwards. Verified: `go build ./...` clean, `go vet ./...` clean, `go test ./... -race -count=1` clean (`internal/room` 53.7s, `internal/signal` 2.7s — same coverage gap as before in `internal/metrics`/`internal/config`/`internal/registry`, which have no test files).
2. **`bcryptjs` → native `bcrypt` (blocker 5) — fixed, in `api-keys.service.ts` only** (the machine-to-machine hot path the finding was about; `auth.service.ts`'s human-login path was out of this Phase's scope and left untouched). Added `bcrypt`/`@types/bcrypt` as dependencies; `bcryptjs` stays in `package.json` for `auth.service.ts`. Verified: `apps/api`'s full suite (72 suites, 1162 tests) passes; `tsc --noEmit` clean; **the Alpine Docker build was rebuilt end-to-end** (`docker build -f apps/api/Dockerfile .`) to confirm `bcrypt@6.0.0`'s native binding actually installs and loads on `node:22-alpine` — it ships `musl`-tagged prebuilds (`prebuilds/linux-{x64,arm64}/bcrypt.musl.node`), so no compiler toolchain is needed in either Docker stage, and a `node -e` smoke test inside the built image did a real `hash`→`compare` round trip successfully. A focused microbenchmark (30-way concurrent `compare()`, isolated from DB/HTTP) measured **~14 req/s-equivalent for `bcryptjs` (matching the audit's original ~13 req/s finding almost exactly) vs. ~52 req/s for native `bcrypt`** at Node's default `UV_THREADPOOL_SIZE=4` — a 3.6× improvement, not the "1-2 orders of magnitude" the original prediction assumed, because that prediction didn't account for libuv's default thread-pool cap. Confirmed the cap is the reason: raising `UV_THREADPOOL_SIZE=16` alone (no other change) measured ~105 req/s-equivalent, a 7.4× improvement over `bcryptjs`. **Follow-up worth doing, not done here** (out of Phase 0's stated scope): set `UV_THREADPOOL_SIZE` above its default of 4 in the API's deployment env to actually realize more of this ceiling in production — free, but is an infra/env change, not a code change, so left for the operator to decide rather than silently bundled into this fix.
3. **Unbounded `findAllForProject` (§3.11 finding 7) — bounded, not paginated.** Added a `take: 1000` safety cap (`MAX_ACTIVE_ROOMS_PER_LISTING`), not real cursor pagination: `GET /v1/rooms` is public API returning a bare `Room[]`, and changing that to a paginated envelope would be a breaking response-shape change the audit's own constraints forbid without explicit justification. The cap prevents unbounded growth (matching the existing `take: 500` precedent in `usage-meter.service.ts`'s reaper) without touching the contract at all. Real pagination is still open work, flagged here as needing an additive, versioned change to the endpoint rather than a Phase-0-safe edit. Verified: `rooms.service.spec.ts` (30 tests) passes.

**Not done, and deliberately not claimed as done:** the full `capacity-report.md` §1 HTTP-level re-run (real Postgres+Redis+k6, multi-instance) that the original Phase 0 task list specified — that requires standing up the full stack this pass didn't have set up, and is naturally subsumed by Phase 2's own re-run task at higher instance counts. The microbenchmark above directly measures the specific mechanism that changed (thread-pool vs. main-thread blocking) and is offered as evidence for *that*, not as a substitute for the end-to-end number.

### Phase 1 — Observability — **DONE**

- **Files**: coturn's Azure-generated compose config (enable `--prometheus`, keep it non-public per the existing NSG discipline); new `redis_exporter`/`postgres_exporter` sidecars; `modules/signaling/gateway/signaling.gateway.ts`/`chat.gateway.ts` (add reconnect counters); `services/sfu/internal/metrics` (publisher/subscriber role split, RTCP rate, packet-loss gauge).
- **Tasks**: wire the three missing infra exporters; add the ~6 missing API/SFU metrics identified in §3.9's gap table.
- **Tests/benchmarks**: none required — this phase is instrumentation, verified by scraping `/metrics` and confirming the new series appear under load.
- **Rollout/rollback**: additive only; no rollback risk.

**What actually shipped, with evidence:**

1. **SFU: publisher/subscriber role split.** `internal/room/participant.go`'s `IsPublishing()`/`IsSubscribing()`, `internal/room/room.go`'s `RoleCounts()`, threaded through `Manager.Load()` into two new GaugeFuncs, `raven_sfu_active_publishers`/`raven_sfu_active_subscribers` (`internal/metrics/metrics.go`). Verified live: built the SFU binary, ran it, scraped `/metrics`, confirmed both series present with correct HELP/TYPE.
2. **SFU: RTCP packets/sec.** New package-level `rtcpPacketsProcessed` counter (`internal/room/traffic_totals.go`), incremented in `forwardSubscriberFeedback` for every RTCP packet read (PLI/FIR/Receiver Reports/everything), exposed as `raven_sfu_rtcp_packets_total` via the existing `trafficCollector`. Verified live via `/metrics` scrape.
3. **SFU: packet-loss gauge.** New finding during implementation, not assumed from the audit brief: **no packet-loss computation existed anywhere in the SFU before this** — `ParticipantStatsPayload.PacketLossPct` in `internal/signal/protocol.go` was dead, unused code, never constructed. Built it for real: `DownTrack` now parses `*rtcp.ReceiverReport`'s `FractionLost` in `forwardSubscriberFeedback`, stored in new atomic fields (`lastFractionLost`, `hasLossReport`) and surfaced through `DownTrackStats`. `raven_sfu_packet_loss_fraction` is the mean across subscribers that have reported at least one RR, explicitly 0 (not a false "zero loss") when none have — documented in the metric's own HELP text. Verified live via `/metrics` scrape.
4. **SFU: dedicated ICE-failure counter.** `raven_sfu_ice_failures_total`, incremented in `cmd/sfu/main.go`'s existing `OnStateChange` callback (it already received `iceState` separately from `peerState` — no new plumbing needed), independent of the generic `connections_failed_total`. Verified live via `/metrics` scrape.
5. **API: signaling reconnects — a real signal, not a proxy.** `RoomRegistryService.join()` already computes `wasReconnect` (participant already in the room fleet-wide); added a counter there (`reconnectsTotal`), exposed through the existing `getMetrics()` chain into a new `raven_signaling_reconnects_total` gauge. Direct test coverage added in `room-registry.service.spec.ts`.
6. **API: chat reconnects — an honest proxy, matching a pattern that already existed for dashboard-ws.** Discovered mid-implementation: `DashboardWsGateway` already had exactly this (`totalConnections`, wired to `raven_dashboard_ws_connections_total`, Phase 6H) — the audit's "no dedicated reconnect counter anywhere in chat/signaling/dashboard gateways" finding was accurate for chat and signaling but not dashboard-ws. Chat had no equivalent, so `ChatGateway` got the same `totalConnections` field and `raven_chat_connections_total` gauge, with the same "honest proxy, not a real reconnect signal" caveat in its own doc comment (chat allows legitimate multi-device connections, so it can't distinguish a reconnect from a second device the way signaling's session-replacement logic can).
7. **Coturn: `--prometheus` now enabled in production**, not just local dev. `infrastructure/azure/07-deploy-coturn.sh`'s generated `turnserver.conf` gained `prometheus`/`prometheus-port=${RAVEN_TURN_METRICS_PORT}`. Confirmed the NSG (`02-network.sh`) still does not open 9641 to the Internet — verified by reading the actual rule set, not assumed.
8. **Redis: `redis_exporter` wired for both local dev and production.** `docker-compose.yml` gained a `redis-exporter` service (`oliver006/redis_exporter`) pointed at the local Redis. **Verified live, not just syntax-checked**: brought up `redis`+`redis-exporter` for real, scraped `http://localhost:9121/metrics`, confirmed `redis_up 1`. Production: `infrastructure/azure/06-deploy-sfu.sh` gained the same exporter alongside the existing co-located Redis container, bound to the private NIC only (same discipline as Redis itself); `02-network.sh` gained a matching `AllowRedisExporterFromApps` NSG rule, scoped to the Container Apps subnet only. Generated compose YAML validated (rendered with the script's real heredoc, parsed successfully).
9. **Postgres: `postgres_exporter` — production only, by design.** Not added to local dev's `docker-compose.yml`: there is no local Postgres to point it at (Supabase-managed even in dev, per `docs/deployment/managed-postgres.md`), and running one exporter per developer laptop against the *shared* Supabase project would just add to the connection-count budget §3.12 already flags as tight, for no one to read. New file `infrastructure/azure/18-postgres-exporter-app.sh`: a standalone internal-only Container App (not a VM sidecar — unlike Redis, Postgres has no VM of ours to attach to, and co-locating it on the SFU VM would reproduce the exact "unrelated service riding the media-plane VM's fate" pattern this audit flagged as a Redis risk in §3.5/blocker 4) running `prometheuscommunity/postgres-exporter`'s public image unmodified against the existing `database-url` Key Vault secret — no new secret, no ACR, no managed identity needed. **Verification is partial and stated honestly**: bash syntax and the generated YAML spec both validated locally (parsed successfully, structurally matches the two already-deployed sibling scripts' proven shape). **Not deploy-tested against live Azure** — the subscription backing this deployment is currently disabled (exhausted free-tier credit, confirmed earlier this session), so there was no live environment to test against. Treat this one file as higher-risk-until-verified than everything else in this phase, and re-verify it the first time the subscription is reactivated.

**Not done:** wiring an actual Prometheus server to scrape any of this. Confirmed (again) that no `prometheus.yml`/Grafana config exists anywhere in the repo — every metric in this phase, and every one that existed before it, is "an endpoint that exists," not "a dashboard someone watches." That gap is unchanged by this phase and isn't itself one of Phase 1's listed tasks.

### Phase 2 — API horizontal scaling
- **Finding**: §3.11 already confirms the API has **no process-local state blocking horizontal scaling** beyond the deliberate, safe api-key cache. This phase is validation, not removal-of-state work.
- **Files**: none requiring change; `docker-compose.scale.yml` and `scripts/k6/` for the re-run.
- **Tasks**: re-run `capacity-report.md`'s multi-instance REST/chat benchmarks post-Phase-0 bcrypt fix, at higher instance counts (4-8) than previously tested (1-3), to get real efficiency numbers instead of the small-trial data currently on record.
- **Benchmarks**: 4/8-instance REST and chat throughput, post-bcrypt-fix.
- **Rollout/rollback**: measurement only; no production change.

### Phase 3 — SFU registry/scheduler — **PARTIALLY DONE (locally validated; production Azure deploy still blocked)**

- **Files**: `rtc-server-allocator.service.ts`, `rtc-server-registry.service.ts`, `services/sfu` deployment scripts.
- **Tasks**: deploy a **second real SFU node** for the first time ever; run `scripts/capacity`'s `tiers` sweep against both and confirm least-loaded-node selection actually spreads load correctly live, matching what `rtc-server-allocator.service.spec.ts` already asserts against mocks (`architecture-5k.md` §4 step 2, unchanged recommendation from before this audit — now re-confirmed as the top dependency for everything above single-node capacity).
- **Tests**: the existing allocator unit tests, plus a new integration test that actually joins participants across 2 live nodes.
- **Benchmarks**: 2-node allocation-spread test; do not attempt higher node counts until this one passes.
- **Rollout/rollback**: drain-based (already supported — `raven rtc servers drain`); no new mechanism needed.

**What was actually validated, with evidence — locally, not on Azure:**

Production Azure deployment of a second node is still blocked by the same disabled subscription from Phase 0/1 (`ManagedClusterSuspended`, re-confirmed at the start of this phase — unchanged, exhausted free-tier credit). Rather than skip Phase 3 entirely, the underlying technical question — **does live, non-mocked cross-node allocation actually work** — was answered locally, against real infrastructure that has nothing to do with Azure: the real Supabase-managed Postgres this repo already uses, real Redis, and two genuinely separate `services/sfu` processes (not mocks, not the same process twice).

**Setup**: brought up the full local stack (`docker-compose.yml`) plus one temporary second SFU node (`sfu-local-02`, distinct UDP range, own container) via a throwaway compose override, deleted after. Ran `apps/api` for real against the actual Supabase database (via the real `.env`, `prisma migrate deploy` — no pending migrations, schema already current), created a real project/API key through the real REST API, and drove `room.join` over real WebSocket connections to `/v1/rtc` for 6 distinct rooms.

**Result: it works.** All 6 rooms joined successfully, split 2/4 across the two live nodes (`sfu-local-01`/`sfu-local-02`) — confirmed three separate ways, not just by trusting one log line:
1. `RtcServerAllocatorService`'s own log line for every room, naming exactly which node it picked and that node's then-current room count.
2. Both SFU nodes' own logs showing `"participant added"` for the participants routed to them, each over its *own* node link (not node 1 forwarding to node 2, or vice versa).
3. Each node independently attempted real SFU-side offer negotiation, correctly abandoned it after 15s when the (non-WebRTC) test client never answered (`"negotiation abandoned: no answer within timeout"`) — confirming that mechanism from §1's architecture notes also works correctly against a second live node, not just the first.

**A real, previously-unknown bug found in the process, not a hypothetical.** The first run failed halfway through with `RTC_SERVER_UNREACHABLE` on node 1. Root cause, confirmed by reading both containers' logs: the developer's own `.env` sets `SFU_CONTROL_PLANE_URL=http://host.docker.internal:4100` / `SFU_INTERNAL_URL=http://localhost:7000` — correct for this repo's documented hot-reload workflow (API running on the host via `pnpm start:dev`, not in a container), but wrong once the API runs *as a container* instead, which this validation needed to do. Node 1 kept trying to heartbeat a host-facing address from inside the Docker network and failing with connection-refused; node 2, freshly configured with container-network addresses for this test, worked fine. **This is exactly the class of gap the audit predicted**: two real nodes surfaced an operational/config mismatch that mocked, single-process tests structurally cannot — not a product defect, but proof that "live, not mocked" was the right bar to insist on. Fixed for the test by overriding node 1's URLs to match the container network; reverted afterward, since it's the correct config for this developer's normal (non-containerized-API) workflow.

**A real, honest limitation surfaced too, worth carrying into the roadmap rather than glossing over**: every allocation decision in this run picked a node while both showed **`0/100 rooms`** — the registry's view of "active rooms per node" is only as fresh as each node's last heartbeat (`SFU_HEARTBEAT_INTERVAL_SECONDS`, default 10s), and rooms were created roughly every 3 seconds in this test — faster than the heartbeat could catch up. The 2/4 split (not an even 3/3) is exactly what that lag predicts, not evidence of a broken allocator: "least loaded by active rooms" is correct in design, but its accuracy has an inherent ~10s staleness window that a very fast join burst can outrun. Not a blocker at any scale this audit found evidence for, but worth naming precisely rather than either ignoring it or mistaking the uneven split for a bug.

**Room ownership durability, also reconfirmed live**: every room correctly showed `"released — no longer assigned to an rtc server"` in the API's logs the moment its one participant disconnected — the Postgres-authoritative pin-and-release cycle documented in §3.2 held up exactly as described, now under real multi-node conditions instead of a single node.

**What this does and does not prove.** It proves the mechanism §3.2/§9 could previously only describe from code and mocks — cross-node registration, heartbeating, per-room node-link dispatch, and release — genuinely works against two independent live processes. It does **not** prove Azure-specific behavior (VM-to-VM networking, NSG rules, the real production `SFU_PUBLIC_IP`/ICE-candidate path, or anything at real media-plane load) — none of that was in scope for a two-process local test, and none of it can be validated until the Azure subscription is reactivated. Re-run this same validation against two real Azure VMs as the first thing to do once that happens; expect it to pass given tonight's result, but "expect" is not "confirmed," and this document has been careful everywhere else not to blur that line.

### Phase 4 — TURN scaling — **DONE for config/health-signal; production 2nd node still blocked by the Azure subscription**

- **Files**: `infrastructure/azure/07-deploy-coturn.sh` (second node), token-minting code (`turn-credential.util.ts`, `RtcTokensService`) to return a server list instead of one hardcoded host.
- **Tasks**: stand up a second coturn node; add the config plumbing for multiple TURN hosts; add a TURN health signal (even a simple periodic allocate-and-check, mirroring `08-verify.sh`'s existing acceptance check, run continuously instead of once at deploy).
- **Benchmarks**: relay bandwidth under real concurrent allocations, not yet measured at any scale.
- **Rollout/rollback**: additive (second node); rollback is removing it from the token-minting list.

**What actually shipped, with evidence:**

1. **Multi-host config plumbing — real, and verified end-to-end against two live coturn instances, not just unit-tested.** `configuration.ts`'s `turn.hosts`/`turn.internalHosts` are now arrays (`TURN_HOST`/`TURN_INTERNAL_HOST` always first, `TURN_HOSTS`/`TURN_INTERNAL_HOSTS` add more — unset and it's a one-element array, so a single-node deployment is byte-for-byte unaffected). New `buildIceServersForHosts()` in `turn-credential.util.ts` concatenates one host's worth of STUN/TURN/TURNS entries per configured host — additive to the wire format, not a breaking change to `IceServer[]`. 12 unit tests (4 new) plus a **live local test**: brought up a second real coturn container, pointed a real containerized API at both, minted a real RTC token through the real REST API, and got back **8 ICE server entries (4 per host)** with correct per-host URLs and valid HMAC credentials — confirmed in the actual JSON response, not inferred.
2. **A real TURN Allocate health check, not a stub.** `checkTurnAllocate()` (`health/dependency-checks.util.ts`) ports `infrastructure/azure/tests/turn_allocate.py`'s proven two-step long-term-credential handshake to TypeScript — real STUN/TURN wire parsing, real MESSAGE-INTEGRITY (HMAC-SHA1 over the actual bytes, MD5 key derivation), real XOR-RELAYED-ADDRESS decoding. Explicitly deallocates its own test allocation via a TURN Refresh(LIFETIME=0) immediately after success — without this, a check running every 30s from every API instance would slowly exhaust coturn's relay port range (this repo's own production template is 41 ports), which would have made the health checker itself a capacity hazard. Unit-tested with a hand-built fake coturn server that verifies the real MAC (5 new tests: success, private-relay detection, wrong-secret rejection, forged-credential rejection, timeout).
3. **`TurnHealthService` — the continuous version of `08-verify.sh`'s one-time deploy check**, closing the exact gap the Redis/TURN audit fork found ("no TURN health state machine feeding allocation or credential minting"). Runs independently per API instance (same reasoning as `RtcServerRegistryService`'s stale-node sweep — a read-only probe, not worth coordinating), exposes `raven_turn_healthy{host}` and `raven_turn_health_check_failures_total{host}` via the same `MetricsService` pattern every other gateway gauge uses. Deliberately does **not** feed back into token minting yet (an unhealthy host still gets handed to clients) — flagged in the code as a real design decision for later, not silently done here.
4. **Live validation surfaced a real, previously-undiagnosed operational gap — and confirmed the check catches it correctly.** The pre-existing local `coturn` container (running 5 days) had been started with `.env.example`'s placeholder secret; `.env`'s real `TURN_SECRET` had been rotated since without recreating the container. `checkTurnAllocate` correctly reported `401` against it. This is exactly the class of "operator rotated a secret, forgot to redeploy" incident this service exists to catch — the local test only *found* it because a local dev container happened to be stale; the mechanism that caught it is the same one that would catch it in production. Resynced the container and reverified success afterward (verified independently three ways: the proven Python reference script, a hand-copied debug reproduction, and the actual compiled service code, all three via the exact container-network path the real service uses).
5. **Confirmed the check's own core purpose against real infrastructure**: both local coturn nodes correctly reported `isPrivateRelay: true` (auth succeeds, but the relay address is a private Docker-bridge IP) because neither has `external-ip` set in local dev — exactly the finding the Redis/TURN audit fork made earlier and exactly the failure mode `checkTurnAllocate` is built to catch. Production's `07-deploy-coturn.sh` does set `external-ip`, so this is a local-dev-only condition, not a production gap — but it's real proof the detection logic works, not a hypothetical.
6. **Failure-mode coverage**: stopped the second coturn container mid-test; Docker removed it from internal DNS, producing `ENOTFOUND` rather than a timeout — confirmed the check resolves cleanly (`ok: false`, no hang, no crash) for total-host-loss too, not just auth/relay-address failures. One honest gap found in the process, not fixed: `TurnHealthService` only logs on a `healthy` **boolean** transition, so a host moving between two different *reasons* for being unhealthy (private-relay → unreachable) doesn't produce a new log line, only the failure counter keeps incrementing. Noted here rather than silently left; a real fix (log on reason-string change too) is small but wasn't made, to keep this phase's diff to what was actually asked for.
7. **Production's second node: config-plumbing generalized, not deploy-tested.** `00-variables.sh`'s `RAVEN_TURN_VM`/`RAVEN_TURN_IP_NAME`/`RAVEN_TURN_NSG` are now overridable (they were hardcoded before — the *actual* blocker to reusing `07-deploy-coturn.sh` for a second node at all), plus new `RAVEN_TURN_EXTRA_VMS`/`RAVEN_TURN_EXTRA_IP_NAMES` (paired by position) that `13-api-app.sh` now reads to build `TURN_HOSTS`/`TURN_INTERNAL_HOSTS` for the Container App. No new provisioning script — a second node reuses the exact same `02-network.sh`/`03-vms.sh`/`07-deploy-coturn.sh` invocations with different name overrides, since `create_vm()` was already parameterized. **What was and wasn't verified**: the pure-bash array-pairing/host-list-building logic was tested in isolation with mocked `az` CLI calls (1 extra node, 2 extra nodes, and a deliberate VM/IP-name-count mismatch all produced correct results). The actual `az` resource lookups themselves — and everything about real Azure networking, DNS, NSGs — are **not** verified, for the same reason as Phase 3: the subscription is still disabled. Treat this file as unverified-until-deployed, same discipline as Phase 1's `postgres_exporter` script.

**Not done, stated plainly:** relay bandwidth under real concurrent allocations (needs real client load, not a control-plane health probe) and an actual second production coturn VM. Both remain open, and both are Azure-subscription-gated, not code-gated.

### Phase 5 — Database/Redis optimization — **Postgres: investigated with real evidence, one speculative change deliberately NOT made. Redis: analyzed, a real resource conflict found, implementation deferred pending an operator decision.**

- **Files**: `schema.prisma` (`Message` composite index, if the query pattern is confirmed needed); Redis topology (decouple from the SFU VM first, per blocker 4).
- **Tasks**: confirm the actual Supabase project tier's connection ceiling (a deployment fact, not a code change) and re-derive the safe `N instances × DATABASE_POOL_MAX` ceiling for the target deployment; move Redis off the SFU VM onto its own host/managed service.
- **Benchmarks**: connection-count ceiling at the confirmed Supabase tier.
- **Rollout/rollback**: Redis move needs a brief coordinated cutover (connection-string change across all instances); index addition is a standard migration.

**What was actually found, with evidence:**

1. **The Supabase connection ceiling — a real number, not a placeholder, for the first time.** Queried the live database directly (safe: `SHOW max_connections` / `pg_stat_activity`, no writes, no schema changes): **`max_connections = 60`** on this project's underlying Postgres. `pg_stat_activity` at the time of the check showed 13 active connections, of which 6 were Supabase's own platform services (`Supavisor`, `postgres_exporter`, `PostgREST`, `pg_cron scheduler`, `pg_net`, `Supavisor (auth_query)`) — real, permanent baseline consumption independent of Livqeno's own traffic. `DATABASE_URL` (what the app actually uses) is the transaction pooler on `:6543` (Supavisor), not a direct Postgres connection — the pooler multiplexes many client-side connections onto a smaller backend pool drawn from this same 60-connection ceiling, and that specific sub-allocation (Supavisor's own `pool_size`) is **not queryable via SQL** and needs Supabase dashboard access this session doesn't have for this project (the authenticated `supabase` CLI is logged into a *different* account — two unrelated projects, neither matching this one; deliberately did not attempt to `supabase link` against the wrong account). **What this changes**: `docs/rtc/scaling.md`'s existing guidance ("N instances × DATABASE_POOL_MAX must stay comfortably under [max_connections]") can now be checked against a real number for this project — at the default `DATABASE_POOL_MAX=10`, even a naive direct-connection model caps out around **5-6 API instances** before contending with Supabase's own platform-service connections, well short of what a 10K-user deployment would eventually want. This is a real, load-bearing ceiling for *this specific Supabase project's current tier* — a paid-tier upgrade raises it, and that's an account/billing decision, not a code one.
2. **The flagged `Message` composite index — investigated with real `EXPLAIN ANALYZE` against real data, and deliberately NOT added.** `messages.service.ts`'s `list()` confirmed the `senderId`-filtered query path is real and client-facing (`ListMessagesDto.senderId`, exercised whenever a caller filters message history by sender), not hypothetical — so the audit's own conditional ("add it if the query pattern is confirmed needed") required checking further rather than skipping. Ran the exact query shape against the live `chat_messages` table (366 real rows, not synthetic): Postgres already uses the existing `chat_messages_idempotency_key` unique constraint (`[conversationId, senderId, clientMessageId]`, added for idempotency, not query planning) as an index scan for `conversationId + senderId`, paying only a small in-memory sort on top for the `createdAt` ordering — 2.5ms total, `Sort Method: quicksort, Memory: 27kB`. That sort cost stays small regardless of total table growth, because it's scoped to one sender's messages in one conversation — a bounded, naturally-small subset — not the whole table. **Conclusion: adding a 4th index purely to eliminate that already-cheap sort is not justified against the real write-cost of maintaining it on `chat_messages`**, independently confirmed elsewhere in this audit as the hottest table in the schema. This is exactly the audit's own instruction followed to the letter: "otherwise re-confirm it's genuinely unneeded before adding write overhead to the hottest table in the schema" — confirmed, with evidence, not assumed. Worth re-measuring if a real deployment's per-sender-per-conversation message counts grow far past what 366 total rows can represent.
3. **Redis decoupling — a real resource conflict found, which changes the recommendation.** The application side is already fully topology-agnostic (confirmed by reading `redis.service.ts`: a bare `new Redis(REDIS_URL)`, no code anywhere assumes co-location with the SFU) — decoupling is purely an ops/deployment change, exactly as the roadmap already said. But provisioning a **third dedicated VM** for Redis runs directly into a constraint discovered by re-reading `00-variables.sh`'s own existing comment, not a new one: this Azure subscription's **regional quota for the Basv2 VM family is 6 vCPUs total**, and the SFU (2 vCPU) + coturn (2 vCPU) already consume 4, leaving exactly **2 vCPUs of headroom** — precisely enough for *one* more `Standard_B2ats_v2`-class VM. **This means a dedicated Redis VM, a second SFU node (Phase 3), and a second TURN node (Phase 4) cannot all be added under the current quota — at most one of the three fits without a quota-increase request.** That request is an Azure-support action, not something this audit or any code change can do. Given this real conflict, the more defensible recommendation is **Azure Cache for Redis (a managed service)** instead of a dedicated VM — it draws from a completely different quota family, so it doesn't compete with Phase 3/4's own VM-based scaling plans. **Deliberately not implemented**: provisioning either option needs the Azure subscription reactivated first (same blocker as every other Azure item in this audit), and — unlike Phase 3/4, where the "what to build" was unambiguous — this is a genuine fork with a real tradeoff a human should decide, not something to pick autonomously and script blindly. Documented here as a decision-ready analysis rather than unverified provisioning code for a path that might not be the one actually chosen.

**Not done:** the actual Redis migration (needs the subscription reactivated, then a decision between the two paths above) and re-deriving the exact `N × DATABASE_POOL_MAX` ceiling once Supavisor's own pool-size setting is known (needs Supabase dashboard access to the correct project, or an operator's own knowledge of their plan tier).

### Phase 6 — Load testing: 100 → 500 → 1K → 2.5K → 5K → 10K — **BLOCKED on real multi-node Azure infra; the distributed load-generator prerequisite itself is now built and verified locally**
- **Prerequisite**: Phase 0 (bcrypt), Phase 3 (2-node SFU proven), Phase 4 (2-node TURN), and the distributed load-generation rig from blocker 1 must all land first — running this phase before them would just re-measure the same known ceilings.
- **Tasks**: run the distributed rig at each tier, on real multi-node infrastructure, recording the same fields the existing rig already produces (`mediaAlivePercent`, `sfuCpuPercent`, `outboundMbps`) plus fleet-wide reconnect-storm behavior specifically at the 1K and 10K simultaneous-reconnect scenario from §5.
- **Benchmarks**: this phase *is* the benchmark program; every number in §2's "what's required" list gets produced here.
- **Rollout/rollback**: test-environment only; no production rollout risk, but each tier's pass/fail bar should match `architecture-5k.md` §1's existing discipline (≥95% media-alive, no uncoded 5xx, no SFU crash, reproducible by an independent second run).

**What was actually found and built, with evidence:**

Re-checked the Azure subscription first (`az containerapp revision list`): still `ManagedClusterSuspended`, no change. Phase 3/4's own numbers are therefore still only locally validated, not on real Azure infrastructure — one of Phase 6's two prerequisites remains unmet, and no amount of local work changes that. Running the full 100→10K tier sweep now would, exactly as this phase's own text already said, re-measure the same single-machine ceiling `live-streaming-media-capacity.md` and `architecture-5k.md` already document (~125 viewers, rig-bound) rather than produce a real answer.

The other prerequisite — "the distributed load-generation rig from blocker 1" — did not exist at all before this phase: `scripts/capacity`'s existing harness (`run.mjs`) is explicitly single-machine, by its own README's admission. That gap was closed:

1. **`worker.mjs`, a viewer-only, containerizable shard.** Unlike `run.mjs`'s `Rig`, which boots its own API and SFU, a worker owns nothing but a slice of the audience: it mints its own viewer identities (`--offset` avoids collisions across workers), opens real Chromium pages against an already-deployed, real fleet, and writes its own raw per-viewer samples to `--out`. This is the structural change that makes distribution possible — N of these is N renderer processes, each optionally its own physical machine, never N competing stacks fighting over the same stream.
2. **`coordinate.mjs`, the one process that owns the stream.** Provisions a project, creates and starts the stream, publishes to it from its own local Chromium host page (using the same non-synthetic Y4M content `Rig` does, not Chromium's default colour-wheel camera), launches N worker containers (`docker run`, each optionally `--context <name>` — Docker's own existing cross-host mechanism, not a new one), and merges every worker's raw samples through the *same* `diffSamples`/`summariseJoins` code `run.mjs` already uses. The merged result lands in `results/` in the identical JSON shape `tiers` rows already use.
3. **`Dockerfile`, packaging the harness as an image** (`raven/capacity-worker:dev`), mirroring `services/egress-worker/Dockerfile`'s proven multi-stage shape: build stage compiles the real `@ravenkash/rtc`/`chat`/`client` SDKs the harness pages import, runtime stage is Playwright's own Chromium image plus just `worker.mjs` + `lib/` + `harness/` — no Go, no Postgres, no ffmpeg, since a viewer-only worker never opens a camera or runs its own SFU. Built clean, verified with `docker build`.
4. **A real bug found and fixed in the process, not specific to distribution**: `SfuProcess`/`DockerSfuProcess` in `lib/stack.mjs` hardcoded `SFU_PUBLIC_IP=127.0.0.1` with no override — meaning the SFU's ICE candidates were never reachable from anything but the same machine, containerized or not. Added a `publicHost` option (default `127.0.0.1`, unchanged for every existing `run.mjs` scenario) threaded through `Rig`'s new `sfuPublicHost` option, so a caller can point the SFU's advertised address at wherever its real viewers actually are. This is exactly the same class of fix Phase 4 made for `TURN_HOST`/`TURN_HOSTS` — a single hardcoded loopback address standing in for "wherever this is really deployed."
5. **Verified end to end, locally, for real** — not claimed without running it. Built a real API+SFU via `Rig` (not mocked), pointed `API_PUBLIC_URL` and the new `sfuPublicHost` at this machine's LAN address instead of the default loopback (a container's own `127.0.0.1` is itself, not the host — the same reasoning as Phase 3's `SFU_CONTROL_PLANE_URL` fix), then ran `coordinate.mjs` against it with real `docker run` worker containers:
   - First pass (2 containers × 5 viewers) surfaced two real bugs before it produced a real result: the SDK's signaling endpoint is server-computed from `API_PUBLIC_URL` (not client-supplied), so it had to be set correctly, not just reachable from the coordinator's own process — and `coordinate.mjs`'s original before/after sample selection used each worker's *first* sample (taken the instant `joinAll()` returns, while ICE is still `connecting`) as the "before" snapshot, which reads as `no-video-stats` by construction regardless of whether media ever flowed. Fixed to use the last two samples instead — the same "compare two observations after steady state" shape `run.mjs`'s own `measureWindow()` uses.
   - Final run: **3 worker containers, 30 real viewers, 28/30 (93.3%) media-alive, 29.9 fps mean decode, 47.38 Mbps real viewer-side inbound throughput, 0% loss, 0 freezes.** Real Chromium, real minted credentials, real `RTCPeerConnection`s, real RTP — the full mint → join → decode → sample → merge pipeline, through an actual container boundary, holding up under a fleet larger than one renderer process could shard.

**What this does and does not prove.** It proves the distributed harness itself is real, working infrastructure — not a script that has never been run. It does **not** prove distribution across physically separate machines (`--context` is the intended path — Docker's own real cross-host mechanism — but exercising it needs a second real machine, which this environment doesn't have), and it is nowhere near 5,000 or 10,000 viewers, which needs the real Azure fleet from `architecture-5k.md` §3 to receive them, not just workers capable of generating that many connections. Both gaps are named explicitly in `docs/production/architecture-5k.md` §4 and `scripts/capacity/README.md`'s new "Running it distributed" section, alongside exactly what's proven and what isn't — no result here is claimed at a scale it wasn't actually run at.

**Not done, and blocked on the same standing constraint as Phases 3–5**: the actual 100→10K tier sweep against real multi-node Azure infrastructure. Every piece Phase 6 needed built is now built; what remains is entirely a matter of Azure being reactivated, plus (for the "physically separate machines" half of "distributed") access to a second real host — neither of which is something local work can manufacture.

### Phase 7 — Multi-region
- Explicitly gated on single-region scaling being validated first (this audit found no evidence single-region 1K+ has been validated yet — see §2). No files or tasks specified here; scoping multi-region before Phase 6 completes would be planning against numbers that don't exist yet.

## 10. Required benchmarks — consolidated

(Full detail in §2's capacity-model section above; repeated here as a flat checklist.)

1. 100 viewers at 360p (real camera bitrate), sustained ≥20 minutes.
2. Any tier above 125 viewers/participants, at any bitrate, on a single SFU node — the true per-node ceiling is still unknown.
3. ~~Multi-node SFU allocation under real, non-mocked load (2 nodes minimum).~~ **Locally validated in Phase 3** — real allocation, real per-node dispatch, real release, confirmed correct against two live SFU processes (see Phase 3's write-up above). **Still needed**: the same validation against two real Azure VMs, once the subscription is reactivated — this proved the mechanism, not the production network path.
4. ~~A distributed, multi-machine load generator capable of producing thousands of independent real viewers.~~ **Built and verified locally in Phase 6** (`coordinate.mjs`/`worker.mjs`, containerized): 30 real viewers across 3 containers, 93.3% media-alive, real decode/throughput numbers. **Still needed**: a run at actual thousands-of-viewers scale (needs benchmark 2's real fleet to receive them) and at least one worker on a genuinely separate physical host, to prove cross-machine distribution rather than same-host containerization.
5. TURN relay capacity under load (currently zero data).
6. Chat at 10,000 real concurrent connections (currently extrapolated only, from a 1,500-connection measurement).
7. A widened production UDP/relay port range, re-tested, to rule out configured ceilings as false capacity limits.
8. The 1,000- and 10,000-simultaneous-reconnect scenario, run for real once benchmark 4 exists.
9. ~~The actual target deployment's Supabase project-tier connection ceiling~~ **Partially measured in Phase 5**: `max_connections=60` for this project, confirmed live. **Still needed**: Supavisor's own pooler-side backend pool size (the number that actually governs `N × DATABASE_POOL_MAX` through the transaction pooler apps/api uses — not directly queryable via SQL, needs Supabase dashboard access this session didn't have for this project).

## 11. Recommended target architecture

Unchanged in shape from what's documented today — this audit found no reason to redesign the two-plane split, and the constraints in §12 explicitly forbid doing so. The target is the **current architecture, fully proven at scale rather than partially proven**:

```text
Client SDKs (Web/React/RN/Flutter — parity-fixed per blocker 7)
        │
Load balancer → N stateless API instances (proven horizontally scalable, §3.11)
        │                                    │
   Redis (moved off the SFU VM,        Postgres (Supabase, pooler-sized to
   Sentinel only once volume            confirmed connection ceiling, §3.12/§Phase5)
   demands it, §Phase5/blocker 4)
        │
   ≥2 SFU nodes (allocator proven live, §Phase3/blocker 2)
        │
   ≥2 TURN nodes (server-list token minting, §Phase4/blocker 3)
```

The only structural additions beyond "prove what exists": a TURN server list instead of one hardcoded host (additive, non-breaking), and Redis decoupled from the SFU VM's fate (an ops change, not an architecture change). Everything else in this diagram is already built — the roadmap in §9 is about proving and hardening it, not building something new.

## 12. What NOT to change

Carried over verbatim from the audit's own constraints:

- Do not replace Pion, Postgres, or Redis.
- Do not rewrite the SFU.
- Do not introduce Kubernetes, Kafka, or microservices for their own sake.
- Do not introduce a new database.
- Do not change public SDK APIs unless a specific blocker in §8 requires
  it and says so explicitly — the Web SDK parity fix (blocker 7) is
  additive, not a breaking change, and satisfies this.
- Do not increase ICE failure timeouts, and do not remove or redesign the
  ICE candidate buffering/draining, the ~12s recovery watchdog, the
  one-shot ICE restart, or the generation guards — §3.8 assesses their
  safety under concurrency without touching any of them.
- Do not change TURN behavior merely to make a benchmark pass.
- Do not claim 10K capacity without the benchmark evidence listed in §2
  and §10 above.

No phase in §9's roadmap violates any of the above: none touches Pion,
Postgres-the-database, or Redis-the-technology; none introduces
Kubernetes/Kafka/unnecessary microservices/a new database; the only
SDK-facing change (blocker 7) is additive; no ICE timeout or mechanism is
touched, only assessed; TURN gets a second node and a server list, not a
behavior change aimed at a benchmark.

---

## Final summary

**CURRENT — what is already horizontally scalable:**
The control plane (`apps/api`) is horizontally scalable today, verified by direct code audit: no process-local state blocks it beyond one deliberate, safe api-key verification cache, every cross-instance-visible state (room membership, chat fan-out, rtc-server registry, allocation) is Redis- or Postgres-backed with correct fail-open/idempotent/conditional-write design, and this is confirmed by measurement too (94.7% scaling efficiency at 2 REST instances; zero errors across 1-3 instances for live-stream token minting). Chat's architecture is independently confirmed sufficient for 10K connections "with modest changes" by the project's own roadmap. **The SFU's multi-node allocation is no longer just unit-tested code** — Phase 3 ran it live against two real, independent SFU processes for the first time (real Postgres conditional-write assignment, real per-node heartbeating, real node-link dispatch, real release-on-empty), and it worked, including correctly abandoning a negotiation that a non-answering client left hanging. **TURN is the same story** — Phase 4 ran real multi-host credential minting and a real authenticated-Allocate health check against two independent live coturn nodes, found and diagnosed a real config-drift bug in the process (a stale secret on a long-running local container), and confirmed the health check correctly detects both a private-relay misconfiguration and total host loss.

**BLOCKED — what prevents scaling further:**
Two things now, not three or four — Phases 3 and 4 closed the two biggest ones for their respective components, and Phase 6 closed most of a third. (1) The single-machine load-generation rig (`run.mjs`) still cannot produce more than ~125 independent real viewers by itself — but Phase 6 built and verified the distributed alternative (`coordinate.mjs`/`worker.mjs`, containerized, 30 real viewers across 3 containers at 93.3% media-alive in the local check), so the *mechanism* to go past that ceiling now exists. What's still missing is a real fleet large enough to receive thousands of viewers, and (for genuine cross-machine distribution, as opposed to the verified same-host container case) a second physical host — neither of which local work can produce. (2) Every client reconnect costs as much as a fresh join with no adaptive throttling, so the exact kind of shared-cause failure a single-SFU/single-TURN-node deployment would itself produce (bottleneck 1/2 in §3) turns into a reconnect storm sized like thousands of fresh joins against a control plane rated in the low hundreds of req/s — the platform's failure modes and its recovery mechanism actively compound each other at the scale this audit was asked about. A third item remains an *infrastructure* blocker rather than a code one: the Azure subscription backing production has been disabled (exhausted free-tier credit) since partway through this audit — confirmed still disabled as of Phase 6 — so neither Phase 3's SFU-allocation mechanism nor Phase 4's multi-TURN-host mechanism has been re-validated against real Azure VMs, and Phase 6's actual 100→10K tier sweep cannot run at all, regardless of how ready the load generator now is. Cheap and low-risk to fix (reactivate/upgrade the subscription), but it is the reason Phases 3, 4, and 6 are all marked partial rather than fully done.

Phase 5 added a fourth, different kind of blocker worth naming on its own: **the Azure subscription's VM quota (2 vCPUs headroom) cannot fit more than one of {2nd SFU node, 2nd TURN node, dedicated Redis VM}.** This isn't a code gap or even purely the subscription being disabled — it's a real resource ceiling that will still bind after reactivation unless a quota increase is requested or Redis moves to a managed service instead of a VM.

**NEXT — what should be implemented first:**
Phases 0, 1, and (locally) 3, 4, and 6 are done, and Phase 5 produced two real findings without needing implementation (see their sections above for exactly what shipped/was found and how each was verified). What's next, in order: (1) reactivate the Azure subscription — nothing further can be validated against real infrastructure until then; (2) **decide** Redis's path (managed Azure Cache for Redis is the recommendation, specifically to avoid the VM-quota conflict with the next two steps) and either implement it or request a quota increase; (3) deploy a real second SFU node and a real second coturn node to Azure and re-run Phases 3 and 4's exact local validations against them, since local two-process tests prove the mechanisms but not the production network path (VM-to-VM, NSGs, real `SFU_PUBLIC_IP`/`external-ip`); (4) then Phase 2's higher-instance-count re-benchmark, which depends on having real multi-node infrastructure to point at; (5) run Phase 6's now-built distributed harness (`coordinate.mjs`) against that real fleet at each tier from 100 to 10,000, ideally with at least one `--context` worker on a genuinely separate physical host so "distributed" is proven, not just containerized.

**10K — what evidence is still required before claiming 10K capacity:**
Of the nine items in §10, two moved from "unmeasured" to "measured, but only locally" (multi-node SFU allocation, multi-host TURN — real evidence, not mocks, but not Azure-specific yet), and one moved from "completely unknown" to "partially measured" (Supabase's connection ceiling — `max_connections=60` is now a real number, though the pooler's own sub-allocation still isn't). Of the two structural prerequisites that were fully open, one is now partially closed: a distributed load generator exists and is verified end-to-end at 30 real viewers across containers, though not yet at thousands of viewers or across physically separate machines. The other — a real measurement (not the current extrapolation) of the 1,000-and-10,000-simultaneous-reconnect scenario — remains fully open. Until a real fleet exists to run the now-built harness against — and until Phases 3 and 4's validations are repeated against real Azure infrastructure rather than local processes — no number this audit could produce about "10,000 concurrent users" would be a measurement — it would be exactly the kind of unverified capacity figure this document's own sources (`capacity-report.md`, `architecture-5k.md`) were written to warn against trusting.
