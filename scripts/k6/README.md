# Load testing

Five scripts, one per surface the production-scale plan asks for
(API / Chat / RTC / mixed), plus the plumbing that lets any of them
spread load across a horizontally-scaled local fleet:

| Script | Surface | Tool |
|---|---|---|
| `k6/api-load-test.js` | REST control plane (Rooms, RTC Tokens) | k6 |
| `chat-load-test.mjs` (repo root; orchestrated by `k6/chat-scaled-load-test.sh`) | Chat WebSocket | Node + `ws` |
| `rtc-load-test.sh` | RTC media plane (the SFU itself) | `lk load-test` (livekit-cli) |
| `k6/mixed-scenario.js` | Blended REST + chat + RTC-token traffic | k6 |

Install once: `brew install k6 livekit-cli`.

## What this can and cannot prove

A single laptop cannot originate 10,000–20,000 real concurrent
connections **and** run Postgres+Redis+LiveKit+coturn+the API under
test **and** have the load generator itself not be the bottleneck.
File descriptors, ephemeral port exhaustion, and CPU contention between
"the thing being measured" and "the thing measuring it" will all skew
results long before 10K sockets — and there's no way to tell "the API
capped out" from "the laptop capped out" without a second machine.

What these scripts *can* produce, honestly:

1. **A measured per-instance ceiling.** Run a script against a single
   replica, ramping until a defined SLO breaks (each script's
   `thresholds` with `abortOnFail` does this automatically — the
   concurrency at the moment of abort *is* the ceiling). That's a real
   number, not an estimate.
2. **A measured multi-instance scaling efficiency.** Repeat against 2–3
   replicas (`docker-compose.scale.yml`, see below) holding load-
   generator concurrency at a level confirmed not to bottleneck the
   generator itself. Compare max-sustained-concurrency: "2 instances
   handled 1.85× the 1-instance ceiling" is a measured 92.5% scaling
   efficiency, not a guess.
3. **What actually broke first.** Equally important as the raw number:
   Postgres pool exhaustion? Redis command timeout under contention?
   event-loop lag? the load generator's own FD limit? This is
   diagnosable on a laptop even when the absolute concurrency isn't
   representative of a real cluster — and it's what should actually
   drive resource-limit/pool-size numbers, not a guess.

**Extrapolating to 10K/20K from (1) and (2) is a documented
extrapolation, not a fourth measured data point.** State it as
math (`ceiling × efficiency⌈log⌉ ≈ instances needed`), state the
confidence bounds, and say plainly that it hasn't been validated at
that concurrency on any single machine — see
`docs/production/capacity-report.md`.

## Running against a horizontally-scaled local fleet

`docker-compose.yml`'s `api` service has a fixed container name and
host port — both incompatible with `--scale`. `docker-compose.scale.yml`
is an override that clears them, used only for this:

```sh
docker compose -f docker-compose.yml -f docker-compose.scale.yml \
  up -d --scale api=3

TARGETS=$(scripts/k6/discover-api-targets.sh)   # comma-separated base URLs, one per replica
echo "$TARGETS"

k6 run -e TARGETS="$TARGETS" scripts/k6/api-load-test.js \
  --summary-export=scripts/results/api-3x-$(date +%Y%m%dT%H%M%S).json

scripts/k6/chat-scaled-load-test.sh --connections 300 --senders 60 --rate 2 --duration 30

# back to normal single-instance dev:
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale api=0
docker compose up -d api
```

k6 scripts round-robin VUs across `TARGETS` (`k6/lib/targets.js`,
deterministic per-VU so the split is even, not random-per-iteration).
`chat-scaled-load-test.sh` runs one full copy of `chat-load-test.mjs`
per discovered replica in parallel and divides the requested connection
count across them.

## Per-script usage

**API (REST):**
```sh
TARGETS=$(scripts/k6/discover-api-targets.sh)   # or: TARGETS=http://localhost:4100
k6 run -e TARGETS="$TARGETS" scripts/k6/api-load-test.js
```
Default ramp sweeps 100 → 1K → 5K → 10K → 20K VUs; a real run typically
aborts well before the top once the SLO (p95 < 500ms, error rate < 1%)
breaks — that's the measurement, not a failed run. Override with
`-e STAGES='[...]'` for a targeted sweep.

**Chat:**
```sh
node scripts/k6/provision-api-key.mjs http://localhost:4100   # one-off single-instance key
node scripts/chat-load-test.mjs --api-key <key> --connections 300 --senders 60 --rate 2 --duration 30

# or, scaled:
scripts/k6/chat-scaled-load-test.sh --connections 300 --senders 60 --rate 2 --duration 30
```
`chat-load-test.mjs` is unchanged in spirit — see its own header for
what it measures. One fix landed this pass: it used to derive the
WebSocket host from the server's self-*advertised* `chatUrl`, which is
right when everything sits behind one shared load balancer but wrong
when pointed at one specific replica behind its own port (exactly
`chat-scaled-load-test.sh`'s situation) — it now connects to whatever
`--api-url` was actually given.

**RTC (the SFU):**
```sh
scripts/rtc-load-test.sh --video-publishers 10 --subscribers 40 --duration 2m
```
Wraps `lk load-test` — see `scripts/rtc-load-test.sh`'s header for why
a hand-rolled media load generator isn't the right tool here. Measures
the SFU side only; RTC token-*minting* throughput (the control-plane
side of RTC capacity) is a different bottleneck, covered by
`api-load-test.js`'s `mint_rtc_token` requests.

**Mixed:**
```sh
TARGETS=$(scripts/k6/discover-api-targets.sh)
k6 run -e TARGETS="$TARGETS" scripts/k6/mixed-scenario.js
```
Three k6 scenarios (`rest_traffic`, `rtc_token_traffic`, `chat_traffic`)
ramping concurrently, each independently sized via `-e REST_STAGES=`,
`-e RTC_STAGES=`, `-e CHAT_STAGES=` (JSON stage arrays, same shape as
`api-load-test.js`'s `STAGES`).

## Results

Every script's raw output should land under `scripts/results/`
(`--summary-export` for k6, redirected stdout for the shell-based ones —
`chat-scaled-load-test.sh` and `rtc-load-test.sh` already do this on
their own). `docs/production/capacity-report.md` is built *only* from
what's in that directory — no number in that report should be
untraceable to a file here.
