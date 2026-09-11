# Live Streaming media-capacity rig

Answers one question with evidence: **how many simultaneous real WebRTC
viewers can one Livqeno SFU serve?**

Everything here runs real Chromium, joins through the public
`@ravenkash/client` SDK against the real `/v1/live-streams` endpoints,
holds real `RTCPeerConnection`s, and counts a viewer as receiving media
only when frames are demonstrably being decoded. No signaling-only
success criteria, and no number that was not read off a running system.

For the control-plane side — how fast one API process mints viewer
tokens, and what a burst past its ceiling looks like on the wire — see
`apps/api/test/live-streams-capacity.e2e-spec.ts` and
`docs/production/capacity.md`. That work is complete and is not
repeated here.

---

## What "media alive" means

A viewer counts only when, between two samples at least a second apart:

1. `framesDecoded` strictly increased, **and**
2. `bytesReceived` strictly increased, **and**
3. the `<video>` element's `totalVideoFrames` strictly increased.

Any one of the three alone can be true of a viewer who is watching
nothing. A decoder that emitted frames once and stopped satisfies (1)
at a single point in time. RTP arriving into a decoder that cannot use
it — a codec mismatch — satisfies (2). (3) is maintained by the
renderer rather than the WebRTC stats subsystem, so it is an
independent witness to the other two.

`connectionState === 'connected'` is deliberately not on the list.

`framesDecoded` is not on the SDK's public `TrackStats`, and should not
be — no application needs a raw cumulative decoder counter. The harness
reads it by tapping `window.RTCPeerConnection` before the SDK loads
(`harness/pc-tap.js`) rather than by widening a public API for a test.

---

## Running it

Needs: Go, Docker (Postgres + Redis, and Phase 10's network shaping),
ffmpeg, and a scratch Postgres that is not shared with anything.

```sh
docker run --rm -d --name raven-capacity-db -p 55432:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres postgres:16-alpine

E2E_DB="postgresql://postgres:test@localhost:55432/postgres"
DATABASE_URL="$E2E_DB" DIRECT_URL="$E2E_DB" \
  pnpm --filter @raven/api prisma:migrate:deploy

export CAPACITY_DATABASE_URL="$E2E_DB"
export CAPACITY_REDIS_URL="redis://:<password>@localhost:6379"
export SFU_REGISTRATION_SECRET="<anything; the rig runs its own node>"
```

The rig refuses to start against a non-local database. It writes users,
projects, streams and registry rows and does not clean all of them up.

```sh
node run.mjs tiers       --tiers 10,25,50,75,100 --hold 60
node run.mjs sustained   --viewers 50  --minutes 30
node run.mjs churn       --viewers 50  --cycles 6
node run.mjs restart-api --viewers 25
node run.mjs restart-sfu --viewers 25
node run.mjs soak        --viewers 50  --minutes 120
node api-scaling.mjs     --instances 1,2,3 --requests 600 --concurrency 30
node network.mjs         --viewers 10
```

`--skip-sdk-build --skip-api-build` skips the rebuilds between runs.
Results land in `results/` as JSON with every sample retained.

---

## What the rig owns

It builds and runs its own stack rather than attaching to
`docker compose`:

- **Its own API process** (`apps/api/dist/main.js`). A restart has to be
  a real SIGTERM and a real cold boot, CPU and RSS have to be
  attributable to the API alone, and Phase 9 runs three at once. All
  three need a pid.
- **Its own SFU**, built from `services/sfu` at HEAD, with a UDP range
  wide enough for the largest tier and a node id unique to the run.
- **A cleared registry.** Every `rtc_servers` row except this run's is
  deleted at startup. A dead row from an earlier suite caused a real
  join failure during development: the allocator handed a room to a
  node that had not existed for hours.

## The rig's own limits, stated rather than glossed

- **Viewers are sharded across pages, not processes.** Each viewer has
  its own PeerConnection, DTLS session and decoder, so the SFU does N
  subscribers' worth of work. What is shared within a shard is a
  renderer's heap and main thread. That removes per-device cost the SFU
  cannot see and adds main-thread contention the viewer-side numbers
  can. Every sample records browser CPU and machine load alongside SFU
  CPU so the two are always separable — if the rig were the limit,
  decoded frame rate would fall while SFU CPU and outbound Mbps stayed
  flat.
- **The publish profile drives every throughput number.** Chromium's
  default fake camera is a rotating colour wheel that encodes at a
  fraction of real camera bitrate; the rig generates a Y4M loop with
  whole-frame motion and grain instead (`lib/content.mjs`) and reports
  the publisher's measured bitrate beside the results.
- **Throughput is payload, not wire.** The SFU's byte counters are RTP
  payload; UDP/IP framing, SRTP tags, RTCP and STUN are excluded, so
  the figure sits a little below what a NIC would show.
- **Phase 10 is emulated, not geographic.** `tc netem` imposes real
  latency and loss on real RTP, and reproduces none of a real path's
  middleboxes, bufferbloat or carrier NAT. The report says "emulated"
  and claims no region it has not served a viewer in.
