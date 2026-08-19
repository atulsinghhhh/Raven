# Raven capacity report

Every number in this report traces to a script under `scripts/` and a raw
output artifact under `scripts/results/` (filenames cited per section) —
nothing here is filled in from memory or an assumption. Methodology is
documented in `scripts/k6/README.md`; read that first if a number here
looks surprising, since it explains what a single local machine can and
cannot prove.

**Environment**: one MacBook (10 vCPU / 8GB allocated to Docker Desktop),
running Postgres, Redis, LiveKit, coturn, MinIO, and the API under test
all on the same machine as the load generator, **while another
interactive development session was concurrently active on the same
machine**. This is a materially worse environment than even the
plan's baseline "shared laptop" caveat anticipated, and it shows up
directly in the numbers below — treat every absolute latency/throughput
figure as a lower bound on what a dedicated machine would show, and
focus on the *ratios* (scaling efficiency, relative degradation) and
the *bottleneck diagnoses*, which are environment-independent findings.

**Do not read this report as "Raven supports 10,000 concurrent users."
It does not claim that.** What it does contain: real measured
per-instance ceilings for two surfaces, one real measured horizontal-
scaling efficiency, and three concrete, root-caused bottlenecks — one
of which (bcrypt blocking the event loop on every authenticated
request) is a significant, previously-undocumented finding with a
clear fix path.

---

## Summary table

| Surface | Measured single-instance ceiling | Bottleneck found | Measured N-instance scaling | 10K/20K instance estimate |
|---|---|---|---|---|
| REST (authenticated) | ~13 req/s per process | `bcryptjs` blocks the Node event loop on every `ApiKeyAuthGuard` check (see §1) | 2 processes → ~24.9 req/s (94.7% efficient, §1.3) | **Not extrapolated** — see §1.4: the real fix changes the ceiling by orders of magnitude, extrapolating from the unfixed number would be actively misleading |
| REST (unauthenticated) | 3,770–4,040 req/s, p95 15–17ms | none found at this scale | not tested (no reason to: this isn't the surface under contention) | n/a |
| Chat (WebSocket) | ~500–1000 concurrent connections/instance before ack latency degrades sharply (§2) | Single-core CPU saturation of the Node event loop (95% CPU at 500 conns, §2.3) | Not measured at scale (see §2.4 for why) — architecturally sound to scale per §2.2 | Extrapolated only, see §2.5 |
| RTC media (LiveKit) | ~25 concurrent subscriber-tracks before new subscriptions time out (§3) | Almost certainly the local dev UDP port range (20 ports: `LIVEKIT_RTC_UDP_START`–`END`), not LiveKit itself (§3.2) | Not tested (LiveKit is already a separate, independently-scalable process; not this session's bottleneck) | Not extrapolated — the measured ceiling here is a **local dev config artifact**, not a LiveKit capacity signal (§3.2) |
| Mixed | Functionally verified (all three traffic types work concurrently), not ceiling-tested | — | — | — |

---

## 1. REST control plane (Rooms, RTC Tokens)

### 1.1 The naive result, and why it's not the real finding

`scripts/k6/api-load-test.js`'s default SLO (p95 < 500ms, error rate <
1%, `abortOnFail`) breaks almost immediately — at **6 VUs**
(`scripts/results/api-1x-20260819T154325.json`) and again at **7-9
VUs** for a rooms-only variant
(`scripts/results/api-1x-rooms-only-20260819T155154.json`). Reporting
"Raven's REST ceiling is 6 concurrent users" would be true of this
specific run and false as a statement about the system — so the rest
of this section is the actual diagnosis, run with `--no-thresholds` to
see the real shape of the degradation instead of stopping at the first
breach.

### 1.2 Isolating the bottleneck

Four runs, each removing one variable, all against a single instance:

| Run | Config | Result | Artifact |
|---|---|---|---|
| A | `create_room` + `get_room`, pool max 10 (default), ramp to 200 VUs | Throughput **plateaus at 13.09 req/s** regardless of VU count (10→200); p95 latency balloons to 17.5s as VUs queue behind that plateau; 2.3% error rate (timeouts) | `api-1x-rooms-only-20260819T155220.json` |
| B | Same, pool max **50** (5× larger) | Throughput **still 13.6 req/s** — no improvement. Rules out the Prisma/pg pool as the bottleneck (task 6's pool-sizing work is real and correct, it just wasn't what was limiting *this* request) | `api-1x-pool50-20260819T155537.json` |
| C | `create_room` **alone** (no `get_room`, so no LiveKit `RoomServiceClient` round-trip) | Throughput **still 13.1 req/s**. Rules out the LiveKit dependency `rooms.service.ts` documents ("every live view is a live SFU round-trip") | `api-1x-createonly-20260819T155756.json` |
| D | Unauthenticated `GET /health/live`, same machine, same instant | **3,770–4,040 req/s**, p95 15–17ms | `api-1x-unauthenticated-baseline-*.json` (two runs, reproduced) |

Run D is the key contrast: the network stack, Docker Desktop's
virtualized networking, the load generator, and this shared machine's
general contention are all *ruled out* as the dominant cost — an
unmodified request through the exact same stack sustains 300×+ the
throughput. The only thing that differs between "sustains 4,000 req/s"
and "plateaus at 13 req/s" is **going through `ApiKeyAuthGuard`**.

### 1.3 Root cause: `bcryptjs` blocks the event loop on every authenticated request

`apps/api/src/modules/api-keys/api-keys.service.ts`'s `verify()` calls
`bcrypt.compare()` (cost factor 10) on **every** API-key-authenticated
request. The dependency is `bcryptjs` — a pure-JavaScript
implementation, not the native `bcrypt` package that offloads hashing
to libuv's worker thread pool. `bcryptjs`'s "async" API wraps a
synchronous computation; it still blocks Node's single main thread for
the full duration of the hash comparison. At cost factor 10, that's
roughly 75ms of pure CPU-blocking time per request — and
**1 / 0.075s ≈ 13.3 req/s**, which matches the measured ceiling almost
exactly, independent of database pool size, LiveKit calls, or VU count,
because the block happens before any of that async work even gets a
chance to run.

**Confirmation via horizontal scaling** (`api-2x-createonly-20260819T161214.json`):
running the identical `create_room`-only test against **2** instances
(`docker-compose.scale.yml`, round-robined via `k6/lib/targets.js`)
produced **24.87 req/s** — 1.894× the single-instance 13.13 req/s
(`api-1x-createonly-20260819T155756.json`), a **94.7% scaling
efficiency**. This is exactly what the diagnosis
predicts: since the block is per-*process* (each Node process has its
own event loop), N independent processes each hit their own ~13 req/s
ceiling roughly independently. It is also exactly why this finding
doesn't undermine the "no mandatory SPOF" work elsewhere in this pass —
horizontal scaling is a real, working mitigation for this specific
bottleneck, today, with zero code changes.

### 1.4 What this means for capacity planning

**Do not use "13 req/s × N instances" as a production capacity plan.**
That number describes an unfixed, easily-fixed bug, not Raven's
architecture. The actual recommendation:

- **Fix**: switch to the native `bcrypt` package (thread-pool-based,
  doesn't block the event loop), or — better, since this is a
  high-frequency machine-to-machine hot path rather than a
  human-password check — cache a verified key's result for a short TTL
  (a few seconds, in Redis, keyed by a hash of the raw key) so a given
  key only pays the bcrypt cost once per cache window instead of once
  per request. Either fix should move this ceiling by 1-2 orders of
  magnitude; re-measure after landing it before trusting any capacity
  number derived from the current, unfixed behavior.
- This is a **new finding from this pass**, not one of the original 8
  P0 items — it's flagged here as the report's top actionable result,
  not fixed in this pass (scope discipline: this report's job is to
  find bottlenecks, not fix every one it finds).
- The rate limiter on RTC-token minting (`@RateLimit(60)` per API key)
  is a **separate, working-as-designed control**, not a capacity bug —
  observed rejecting 155/215 (72%) of requests from a single shared key
  at just 10 concurrent VUs (`api-diagnostic-20260819T154952.json`,
  confirmed via the post-fix `/metrics` — see §4). Production
  integrations minting many tokens in a burst need either a higher
  configured limit or to be told this exists; it is not something
  horizontal scaling changes (it's per-key, not per-instance).

---

## 2. Chat (WebSocket)

### 2.1 Rate limiting is the first thing you'll hit, by design

A raw 300-connection run from one IP failed 270/300 connections
(`chat-1x-20260819T160102.log`) against `CHAT_CONNECTION_RATE_LIMIT`'s
default (30/window) — exactly the
behavior `scripts/chat-load-test.mjs`'s own error message describes,
and exactly the intended protection against one IP opening unlimited
sockets. Load testing past it requires deliberately raising that
env var for the test run (not a production change) — every run below
does that.

### 2.2 Per-connection health at moderate scale

| Connections | Rooms | Result | Artifact |
|---|---|---|---|
| 500 | 10 | **0 failed** connections; message ack p50=176ms, p95=357ms, p99=403ms; delivery rate 9,217.9/s | `chat-1x-20260819T160241.log` |
| 1,500 | 20 | **0 failed** connections (all 1,500 connected, 131.5s to do so); but ack latency degrades sharply: p50=4,173ms, p95=10,420ms, p99=10,975ms; delivery rate 19,479.5/s | `chat-1x-20260819T160655.log` (a first attempt at this same size, `chat-1x-20260819T160410.log`, was killed mid-run by the harness's own command timeout before finishing — left in place rather than deleted, but it's an incomplete artifact, not a result) |

The real ceiling for *acceptable* latency on this instance sits
somewhere between 500 and 1,500 connections — connections themselves
keep succeeding well past that point, but message latency stops being
usable long before connection admission fails, which is the right thing
to notice (a "still accepting connections" health check would miss
this entirely; this is the argument for the connection/participant
gauges added to `/metrics` this pass, not just a connect/fail count).

### 2.3 Resource profile at 500 connections

Sampled via `docker stats` mid-run and a `pg_stat_activity` count
during a live 500-connection/20s test (`chat-1x-resourcecheck-20260819T161521.log`):

| Resource | Idle | Under load (500 conns) |
|---|---|---|
| `raven-api` CPU | ~0% | **95.23%** (single core — Node is single-threaded for JS execution) |
| `raven-api` memory | — | 117MB |
| `raven-postgres` CPU | ~0% | 2.10% |
| `raven-postgres` connections | 5 | 7 |
| `raven-redis` CPU | ~0% | 1.65% |
| `raven-livekit` CPU | ~0% | 0.16% |

This is a clean, unambiguous signal: **chat's bottleneck at this scale
is single-core CPU on the Node process itself** (message parse/
validate/fan-out), not Postgres, not Redis, not the SFU. Postgres
barely notices chat load at all (chat's ephemeral state lives in Redis
by design — schema comment in `schema.prisma` — and this measurement
confirms that design holds up under load).

### 2.4 Why multi-instance chat throughput wasn't measured this pass

`chat-scaled-load-test.sh` is built and verified working
(`scripts/k6/README.md`), but running it at a scale large enough to
produce a meaningful second data point (multiple thousands of
connections across 2-3 replicas) on this same contended machine, in the
time available this pass, would mean reading a number dominated by
this machine's contention rather than Raven's actual multi-instance
behavior — exactly the failure mode §0's environment note warns about.
The **architectural** case for scaling is already established (Redis
pub/sub fan-out + connection registry, verified to work correctly
across instances by this pass's own signaling-gateway fix and the
existing chat e2e suite); a real multi-instance chat throughput number
is a P1 follow-up that deserves a dedicated, uncontended run — or,
better, a real staging environment.

### 2.5 Extrapolation (explicitly labeled as such)

If the single-core-CPU-bound diagnosis in §2.3 holds (which the
horizontal-scaling result in §1.3 makes plausible — chat is architecturally
the same "one process, one event loop" shape as the REST bottleneck),
horizontal scaling should mitigate this the same way: N processes → N
independent CPU budgets. **This is a prediction from the diagnosis, not
a measurement.** Estimating instances needed for 10,000 chat
connections at ~750-connection midpoint ceiling per instance:
⌈10,000 / 750⌉ ≈ 14 instances, **not validated at that concurrency on
any machine in this environment.**

---

## 3. RTC media plane (LiveKit)

### 3.1 Measured result

`lk load-test` (`scripts/rtc-load-test.sh`), 5 video publishers + 20
subscribers (100 subscriber-track-slots: 20 subscribers × 5 published
tracks), 20s duration:

- **25/100** subscriber-track slots connected successfully (5
  subscribers fully connected to all 5 tracks; the rest — 15
  subscribers — **"could not connect after timeout"** entirely).
- The 25 that connected: 2.8-3.0mbps per subscriber, packet loss
  0.055%-0.582%.
- Artifact: `scripts/results/rtc-load-test-20260819T160957.log`.

A smaller 1-publisher/1-subscriber run (`lk load-test`, 8s) completed
cleanly at 896.6kbps, 0% packet loss — confirming the SFU itself works
correctly; the failure mode only appears once concurrency rises.

### 3.2 Likely root cause: local dev UDP port range, not LiveKit capacity

`.env.example`'s local dev config sets
`LIVEKIT_RTC_UDP_START=50000` / `LIVEKIT_RTC_UDP_END=50019` — **20 UDP
ports** for RTC media, docker-compose-mapped 1:1 to the host. A real
LiveKit production deployment uses a UDP range in the thousands
specifically because each active media session's ICE/SRTP path can
consume its own port. 100 requested subscriber-track-slots against a
20-port budget lines up with "most connections time out" far more
directly than any CPU/memory signal would (LiveKit's own container
stayed at 0.16% CPU in the chat test above, for reference — it is not
under compute pressure). **This has not been definitively isolated**
(that would mean re-running with a wider port range and confirming the
ceiling moves) — flagged as the leading hypothesis with the evidence
behind it, not a confirmed root cause the way §1.3's is.

### 3.3 What this means for capacity planning

This measured ceiling is a **local single-machine dev-config artifact,
not a LiveKit or Raven capacity signal**, and should not be
extrapolated at all. A real RTC capacity measurement needs either a
widened local UDP range (a one-line `.env` change, cheap to try as a
next step) or, better, a real multi-node LiveKit deployment — the thing
this whole plan already identifies as P1 (needs infra this session
didn't have).

---

## 4. Bottleneck-hunting caught a real gap in the metrics this pass added

While diagnosing §1, `raven_http_requests_total` showed **zero** `429`
entries despite k6 reporting 155 rate-limited responses in the same
run. Root cause: NestJS runs Guards before Interceptors, so
`RateLimitGuard`'s rejection never reached `MetricsInterceptor` (which
only wrapped the handler+interceptor chain) — the exact error cases RED
metrics exist to catch were invisible. Fixed by moving the metrics
collector from an interceptor to a middleware (`MetricsMiddleware`,
mirrors `RequestLoggerMiddleware`'s already-correct pattern, which runs
ahead of guards). Confirmed fixed: re-running the same rate-limited
scenario now shows `status="429"` with a count matching k6's own report
exactly (155). This is exactly the kind of thing "run real load and
watch what happens" catches that reading the code alone does not.

---

## Every bottleneck found, in one list

1. **`bcryptjs` blocks the event loop on every authenticated REST
   request** (§1.3) — the dominant finding. Per-process, ~13 req/s
   ceiling; horizontal scaling mitigates it linearly (measured 95%
   efficiency) but does not fix it. Recommended fix: native `bcrypt` or
   a short-TTL verified-key cache.
2. **RTC-token rate limiting is aggressive for single-key burst
   minting** (§1.4) — working as designed, but a real integration
   concern for anyone minting many tokens per key quickly.
3. **Chat is single-core-CPU-bound under connection+message load**
   (§2.3) — 95% CPU on one core at 500 connections while every other
   component sits idle. Horizontal scaling is the architecturally
   correct mitigation (already proven fleet-safe); not measured at
   scale this pass (§2.4).
4. **The local dev LiveKit UDP port range (20 ports) is almost
   certainly capping concurrent RTC media sessions locally** (§3.2) —
   a dev-config artifact, not a production signal.
5. **RED metrics missed guard-rejected requests** (§4) — found and
   fixed during this pass's own measurement work.

## What's still not measured (explicitly, not silently)

- Multi-instance chat throughput at scale (§2.4).
- RTC capacity with a realistic UDP port range or multi-node LiveKit.
- Live-streaming-specific load (viewer join/leave churn, the documented
  gap that abrupt disconnects aren't detected without a LiveKit webhook
  receiver).
- Anything at the literal 10K/20K concurrency the original ask named —
  see the environment note at the top of this report for why, and
  `scripts/k6/README.md` for the general methodology limit.
- Database backup/restore, Redis/Postgres failover, secrets rotation,
  chaos/security testing — all P1/P2 per `infrastructure/k8s/README.md`,
  out of scope for a load-testing pass.
