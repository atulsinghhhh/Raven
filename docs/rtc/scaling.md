# Livqeno RTC — Scaling

How Livqeno RTC scales, what has actually been measured, and what has not.

The second half matters as much as the first. This document states
measured numbers as measured and unmeasured ones as unmeasured, because a
capacity figure nobody verified is worse than no figure at all — it gets
planned against.

---

## The two axes

**The control plane scales horizontally and statelessly.** Add API
instances behind a load balancer. Room membership and fan-out go through
Redis, so a room split across instances works. No instance owns anything;
restarting one costs its clients a reconnect.

**The media plane scales by adding nodes, and a room lives on one.**

```text
                    Livqeno API (N instances, stateless)
                              │
                        Load balancer
                              │
              ┌───────────────┼───────────────┐
              │               │               │
           SFU-1           SFU-2           SFU-3
              │               │               │
        room_a, room_b     room_c        room_d, room_e
```

Every participant of a room lands on the same node. That is what makes it
an SFU rather than a mesh, and it is the constraint everything else works
around: **one room cannot exceed one node.**

Forwarding media between nodes to serve one room would double the
bandwidth and add a hop of latency to every packet. The control plane
avoids the situation entirely by assigning a room once, on first join, and
keeping that assignment for the session.

---

## A room split across API instances

The load balancer will happily put alice's WebSocket on instance A and
bob's on instance B, in the same room. That works, and the machinery is
worth knowing because it is where a "why did nobody see my join" bug
would live.

`RoomRegistryService` keeps **two** views deliberately:

- a local `Map` of the participants whose sockets *this* process holds,
  which is the only view that can actually write to a socket;
- a Redis set per room (`raven:signaling:room:<id>:participants`, TTL'd),
  which is the fleet's view of who is in the room at all.

The TTL is the important part: it outlives one full missed heartbeat
cycle plus a margin, so an instance that dies mid-cycle leaves a phantom
participant for slightly longer than a live one takes to clean up — and
then it expires on its own rather than needing a janitor.

Fan-out goes through `RoomEventsService`, a room-scoped Redis pub/sub
layer with one duplicated subscriber connection per instance and
ref-counted subscribe per room. The router never resolves a socket: it
returns an *intent* (`toRoom` for a room-wide event, `kickParticipant` to
evict a replaced session) and the gateway publishes it. Every instance
subscribed to that room delivers to whichever local sockets it holds.

Same-instance delivery goes through Redis too, rather than shortcutting
to a local write. That costs a round-trip of latency on an event nobody
is timing, and buys one delivery path instead of a local/remote fork —
which is the fork where a bug hides until the day you scale to two pods.

**The media plane needs none of this.** Negotiation goes to the node over
the node link, and the node's reply comes back on the link the requesting
instance owns — so an SDP answer never needs to find its way across the
fleet. What crosses Redis is only room membership and room-wide events.

### Heartbeats, at two levels

Easy to confuse, and they do different jobs:

- **The gateway's sweep** — one 30-second interval walking every live
  session. A session that did not answer the *previous* ping is
  terminated and treated as a disconnect; otherwise it is marked
  unconfirmed and sent a WebSocket protocol `ping`, which browsers answer
  transparently with no client code. This is what reaps a socket whose
  client vanished without closing.
- **The `ping`/`pong` messages** in the wire protocol. These exist
  because page JavaScript can *receive* a protocol ping but cannot
  *send* one — so a client that wants to measure round-trip liveness
  itself has no other option. Optional; the sweep does not depend on it.

Separately, an SFU node heartbeats to the control plane over HTTP
(`SFU_HEARTBEAT_INTERVAL_SECONDS`, default 10) and a node past
`SFU_HEARTBEAT_TIMEOUT_SECONDS` (default 30) stops receiving new rooms.
Three different heartbeats, three different failure modes.

### A node has no way to deregister

Shutting a node down does not remove its registry row. It stops
heartbeating, and the sweep marks it UNHEALTHY up to 30 seconds later.
That is deliberate: from the control plane's side, a node that has been
stopped on purpose and a node behind a brief network partition look
identical, and treating the first case as "delete the row" would mean
treating the second the same way.

The consequence worth knowing is in `GET /health`. It reports the RTC
plane by picking *a* registered HEALTHY node and probing it, so for up to
`SFU_HEARTBEAT_TIMEOUT_SECONDS` after a node stops, that probe can pick
the dead one and report `sfu: down` while other nodes are serving calls
perfectly well.

For a single-node deployment that is exactly right. For a fleet it is
pessimistic — but not wrong: one unreachable node *is* something an
operator should see, and the fleet page says which one rather than
leaving them to guess. Drain a node before stopping it and the window
closes, because a DRAINING node is not picked for the probe.

---

## Allocation

```text
join arrives
     │
     ├─► does the room already have a node?  ──yes──► use it
     │
     └─no─► pick the least-loaded HEALTHY node
                in the requested region
                  │
                  └─ none? fall back to any region, and log that it happened
                       │
                       └─ still none? NO_RTC_CAPACITY
```

**Least loaded by active rooms**, not participants. Rooms are what the
allocator hands out, and a node's cost is dominated by the number of
forwarding paths, which grows with participants *within* the rooms it
already holds. Balancing rooms keeps that growth spread out.

**Region is a preference, not a constraint.** A participant on a distant
node has worse latency; a participant who cannot connect has no call. The
fallback is logged, so a systematically mis-served region is visible
rather than silently degrading.

**Concurrent joins to an empty room cannot split it.** A Redis lock makes
the race rare and a conditional write makes it harmless: the second writer
finds the room already assigned and uses the winner's choice. Correctness
does not depend on Redis being up — a room join failing because Redis
hiccuped would be a much worse failure than an occasional wasted
allocation attempt.

**A room is released when the last participant leaves**, so the next call
in it is allocated fresh rather than pinned to a node that may since have
been drained.

---

## Health

A node heartbeats every 10 seconds with its current load. Missing the
window (30 seconds by default) marks it `UNHEALTHY`.

```text
HEALTHY   ──── missed heartbeat ────►  UNHEALTHY  ──── heartbeat ────► HEALTHY
    │                                      │
    │                                  no new rooms
  drain                              existing rooms keep running
    │
    ▼
DRAINING  ──── explicit undrain ────►  HEALTHY
```

An unhealthy node **keeps its existing rooms**. A missed heartbeat is
often a paused container or a brief network blip, not a dead process, and
killing live calls over one would be far worse than the alternative. What
changes is only that it stops being chosen for new rooms.

Every API instance runs the staleness sweep. It is idempotent — it only
moves a node whose heartbeat is already past the deadline — so N instances
racing costs N writes on the transition and nothing after. Cheaper than
electing a leader for it.

---

## Regions

```text
SFU_REGION=asia-south    # on the node
```

```ts
await client.join('room_123');   // uses SFU_DEFAULT_REGION
```

```json
{ "type": "room.join", "region": "asia-south" }
```

Region names are free-form strings; Livqeno does not interpret them. Nothing
does geographic proximity resolution — a client asks for a region or gets
the default. Routing a client to its *nearest* region is your load
balancer's or DNS's job, and passing the result through as `region` is how
that reaches allocation.

---

## Capacity: what was measured

The numbers live in **[the test matrix](./test-matrix.md#2-participant-scale-spec-39)**,
alongside everything else that has and has not been tested — one table
rather than two that drift apart, since wall-clock join times vary
noticeably between runs and a second copy is a second thing to be stale.

The short version: 2, 10, 50 and 100 participants all join and all
receive forwarded RTP, plus a 20-way full mesh with 380 subscriptions.
Join cost grows roughly linearly at these sizes.

```bash
go test ./internal/room/ -run TestScale -v
```

**What this proves.** N real `PeerConnection`s can join one room, the SFU
builds the complete forwarding mesh, and RTP actually arrives at every
subscriber at that size. That is the thing most likely to be quietly
broken by a design mistake — a lock held across a network write, say — and
it is worth knowing.

**What this does not prove, and must not be quoted as capacity.** Every
participant in these tests runs in the same process as the SFU, over
loopback, with a synthetic 100-packet-per-second stream: no encoder, no
jitter, no loss, no NAT, no TURN, no real codec bitrate. Real capacity
depends on all of those.

### What has not been measured

Stated plainly. None of the following has a number, and none should be
quoted until it does:

- Participants per node under **real codec bitrates** on real hardware
- CPU and memory per participant, and therefore cost per call
- Behaviour under **packet loss and latency** (the 1%/5%/10% and
  50/100/200 ms matrix)
- **Browser interoperability** at scale (Chrome, Safari, Firefox, Edge)
- **Mobile** (iOS, Android) beyond unit tests
- NAT traversal across the real matrix — symmetric NAT, corporate
  firewall, mobile carrier NAT, TURN relay
- Wi-Fi ↔ cellular handover mid-call
- Multi-node fleet behaviour with real allocation pressure

**Livqeno does not claim a supported participant count.** Anything you read
elsewhere that does, for this release, is wrong.

---

## Sizing what you can reason about

Two hard limits are worth checking before a deploy, because both fail in
confusing ways rather than obvious ones.

**UDP ports.** The SFU refuses to start if its port range cannot hold its
advertised room capacity. Widen the range or lower the capacity — the
alternative is unexplained connection errors under load, which is exactly
when nobody wants to debug it.

```bash
SFU_UDP_PORT_MIN=51000
SFU_UDP_PORT_MAX=51500     # 501 ports
SFU_ROOM_CAPACITY=100      # fine
```

**Postgres connections.** Every API instance's pool competes for the same
`max_connections`. N instances × `DATABASE_POOL_MAX` must stay
comfortably under it, minus headroom for migrations. A PgBouncer in
transaction mode is the recommended topology once instance count makes
that tight; see [capacity-report](../production/capacity-report.md).

---

## Known gaps

**No congestion control.** TWCC feedback is on the wire but nothing
consumes it to drive simulcast layer selection. Under load, a subscriber
on a degrading connection sees packet loss rather than being moved to a
lower layer. This is the most significant scaling gap: it means the
quality-vs-bandwidth trade a large room needs is not yet automatic.

**No dynacast.** The SFU relays every layer a publisher sends, including
one nobody is subscribed to — wasted upstream on a metered connection.

**No room migration.** A room cannot be moved between nodes. Draining a
node waits for its calls to end naturally. The abstraction for migration
exists (`assignedServerFor` / `releaseRoom`); the path does not.

**No cross-node rooms.** By design, and unlikely to change: the bandwidth
and latency cost of inter-node forwarding is real, and the ceiling it
would raise is one node's capacity — which is not yet measured.

---

## Before trusting a deployment

1. Measure participants per node with your **actual** codecs and
   resolutions, on your **actual** instance type.
2. Test with real network impairment, not loopback.
3. Test from a client on a different network from the node.
4. Test with UDP blocked entirely, to exercise TURNS.
5. Test a mobile handover mid-call.
6. Watch `raven_sfu_connections_failed_total` against
   `raven_sfu_connections_succeeded_total` — the connection success rate
   is the single most useful number you have.
7. Write down what you measured. Replace the "not measured" list above
   with it.

---

## See also

- [SFU](./sfu.md) — operating and draining a node
- [Networking](./networking.md) — ports, NAT, firewalls
- [Architecture](./architecture.md) — why a room lives on one node
- [Capacity report](../production/capacity-report.md) — control-plane sizing
