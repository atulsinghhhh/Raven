# Raven RTC — Networking

What has to be reachable for a call to work, and what to do when it is
not.

Production RTC cannot assume clients have publicly reachable addresses.
Most are behind NAT, many behind restrictive NAT, and some behind a
corporate firewall that permits nothing but TCP 443. All three cases are
handled, by different mechanisms.

---

## Ports

| What | Port | Protocol | Who connects | Published? |
|---|---|---|---|---|
| Raven API + signaling | 443 (4000 locally) | TCP | Clients | Yes, via your ingress |
| SFU media | `SFU_UDP_PORT_MIN`–`MAX` (51000–51200 by default) | **UDP** | Clients, directly | **Yes, one-to-one** |
| SFU control | 7000 | TCP | The Raven API only | Internal network only |
| STUN / TURN | 3478 | UDP + TCP | Clients | Yes |
| TURNS | 5349 | TCP (TLS) | Clients | Yes, in production |

### The UDP range must be published one-to-one

```yaml
ports:
  - "51000-51200:51000-51200/udp"   # correct
  - "61000-61200:51000-51200/udp"   # broken
```

ICE advertises the exact port the SFU bound. A remapped range hands
clients addresses that do not exist, and every connection falls back to
TURN or fails outright — with no error that points at the cause.

The range is bounded rather than ephemeral for exactly one reason: it is
what makes a firewall rule writable at all. Size it above the node's
advertised room capacity; the SFU refuses to start if it is not, rather
than failing later as unexplained connection errors under load.

### `SFU_PUBLIC_IP` is not optional in production

```bash
SFU_PUBLIC_IP=203.0.113.10
```

Inside a container or behind a cloud load balancer, the address the SFU
process can see is not the address a client can reach. Without this,
every candidate it gathers advertises an unroutable private IP, and the
only connections that work are the ones that fall back to TURN — which
works, and costs you relay bandwidth for every call.

`SFU_PUBLIC_HOST` is separate and serves a different purpose: it is what
the registry records for operators. `SFU_PUBLIC_IP` is what goes into ICE.

---

## How a connection is actually made

ICE gathers three kinds of candidate and tries them in preference order.

```text
1. host          the client's own LAN address
                 works when client and SFU are on the same network

2. server-       the client's public address, discovered via STUN
   reflexive     works for most NATs — the common case

3. relay         a TURN server forwards on the client's behalf
                 the fallback that always works, and the one that costs
```

```text
Client                                              Raven SFU
  │                                                     │
  ├── host candidate ─────────────────────────────────► │   same LAN
  │                                                     │
  ├── STUN binding ──► coturn ──► "you look like x.y" ─► │   most clients
  │                                                     │
  └── TURN allocate ──► coturn ═══ relayed media ═════► │   restrictive NAT,
                                                            corporate firewall
```

Raven does not choose. ICE does, per connection, and it picks the first
path that works — which means a client on a restrictive network pays for
a relay while a client on the same LAN as the node does not.

---

## TURN

TURN is what makes the difference between "works for most users" and
"works". Roughly 5–15% of real-world connections need a relay; behind a
strict corporate firewall it is 100%.

Raven mints **ephemeral TURN credentials** per token, sharing the token's
lifetime, using coturn's standard HMAC scheme:

```json
{
  "urls": "turn:turn.example.com:3478?transport=udp",
  "username": "1786980869:alice",
  "credential": "<hmac-sha1 of the username, base64>"
}
```

Clients never hold a permanent relay credential. A leaked one expires with
the token it came from.

Four ICE servers come back from every token mint, and forwarding all of
them matters:

| URL | Why it is there |
|---|---|
| `stun:…:3478` | Discovers the public address. Cheapest path. |
| `turn:…:3478?transport=udp` | Relay over UDP. Preferred relay. |
| `turn:…:3478?transport=tcp` | Relay over TCP, for networks that block UDP entirely. |
| `turns:…:5349?transport=tcp` | Relay over TLS on 5349. The last resort that survives deep packet inspection. |

`TURN_TLS_PORT` is **required in production** — the API refuses to start
without it. A deployment with no TURNS listener excludes every user behind
a firewall that only permits TLS.

---

## Firewall rules

### For your deployment

```text
inbound  TCP  443                      → API + signaling (via ingress)
inbound  UDP  51000-51200              → SFU media
inbound  UDP  3478                     → coturn STUN/TURN
inbound  TCP  3478                     → coturn TURN over TCP
inbound  TCP  5349                     → coturn TURNS
internal TCP  7000                     → SFU control, from the API only
```

TCP 7000 must **not** be publicly reachable. It carries the node link,
authenticated by `SFU_REGISTRATION_SECRET`; exposing it lets anyone
holding that secret create peer connections on your node.

### For your users' networks

If you are asked what to allow for Raven to work:

```text
outbound  TCP  443                     required
outbound  UDP  3478                    strongly recommended (STUN)
outbound  UDP  51000-51200 (your range) best quality — direct media
outbound  TCP  5349                    the fallback that always works
```

A network allowing only outbound 443 will still work, over TURNS, with
higher latency and relay cost.

---

## Diagnosing a failed connection

Work outward from the client.

**1. Did signaling connect?** `room.joined` in the SDK's debug log, or a
`4001` close code (bad token) versus a network error (cannot reach the
API).

**2. Did the SFU offer?** No offer means the control plane could not reach
a node:

```bash
curl -s localhost:4000/health | jq .dependencies.sfu   # "up" or "down"
raven rtc servers list                                 # is anything healthy?
```

**3. Did ICE complete?** This is where most real failures are.

```ts
const diagnostics = room.getDiagnostics();
// iceConnectionState:        what the browser thinks
// remoteIceConnectionState:  what the SFU thinks
```

Both `checking` and never `connected` means no candidate pair worked —
almost always `SFU_PUBLIC_IP` unset, the UDP range not published, or the
range remapped.

The two states **disagreeing** is itself the diagnosis: traffic is
flowing one way only, which usually means an asymmetric firewall rule.

**4. Is media flowing?**

```ts
const stats = await room.getConnectionStats();
// bitrateBps === 0 with a connected ICE state: negotiated but nothing sent.
// packetLossPercent high: the path works but is bad — check the relay type.
```

**5. Is it TURN-only?** Check the SFU's own metrics:

```bash
curl -s localhost:7000/metrics | grep raven_sfu_active_participants
```

If connections only succeed with TURN in the ICE server list and fail
without it, direct connectivity is broken — go back to step 3.

---

## Forcing a relay-only path

The single most valuable thing you can test, and the one Raven's own
test suite does not: media that has to go through coturn because no
direct path exists.

`iceTransportPolicy: 'relay'` is the browser's own mechanism — no custom
ICE logic anywhere in Raven. It restricts the local ICE agent to
surfacing only `relay` candidates, so every connectivity check, and
therefore all media, goes through TURN even where a direct path would
have worked.

**`@corvidhq/rtc` does not expose it.** `RTCClientConfig` accepts
`iceServers`, not an arbitrary `RTCConfiguration`, and widening that to
let an application reshape ICE is not a trade worth making for a test
hook. Force it from outside the SDK instead:

```js
// In the page, before joining. Every PeerConnection the SDK creates
// afterwards inherits the policy.
const Native = RTCPeerConnection;
window.RTCPeerConnection = function (config) {
  return new Native({ ...config, iceTransportPolicy: 'relay' });
};
```

Then confirm it actually relayed, rather than assuming:

1. Open `chrome://webrtc-internals` — the authoritative source, and the
   only one worth trusting here.
2. Find the succeeded `candidate-pair` (`state: succeeded`).
3. Its local candidate's `candidateType` must be `relay`. If it is `host`
   or `srflx`, the policy did not take effect and the test proved nothing.

`room.getConnectionStats()` deliberately does **not** report candidate
type. It reports what is measurable and actionable per track — codec,
bitrate, loss, jitter, RTT — and an earlier version of this stack
approximated candidate type by reaching into a media client's
undocumented internals. That shortcut was removed rather than kept:
`webrtc-internals` was always the real source of truth.

### Where this is likely to be awkward locally

On Docker Desktop the SFU advertises `SFU_PUBLIC_IP=127.0.0.1` so a
browser on the host can reach it, and coturn then has to relay *to* that
same loopback address — which coturn blocks by default as an SSRF
guard. The local compose file passes `--allow-loopback-peers` for
exactly this reason, and a real deployment must never set it. Even with
it, host-versus-container addressing on Docker Desktop makes a
browser↔container relay path unreliable; the honest local test is
coturn's own `turnutils_uclient` against the relay data path, and the
browser test belongs on a real network.

---

## Testing beyond a laptop

Everything above works on `localhost` without any of it configured, which
is exactly why local success proves very little. Before trusting a
deployment, verify at minimum:

- A client on a different network from the SFU
- A client behind symmetric NAT (most mobile carriers)
- A client with UDP blocked entirely (forces TURNS)
- A relay-only path, as above
- Mobile data → Wi-Fi handover mid-call

None of these has been verified. See the
[test matrix](./test-matrix.md#5-network-conditions-and-nat-traversal-spec-41)
for the full list and [scaling](./scaling.md) for what has been measured.

### IPv6

Untested, and not known to be broken. coturn reports an IPv6 relay
address on the local Docker network, but no test in this repo has ever
exercised an IPv6 client path — everything has run over IPv4. Both Pion
and coturn support IPv6 natively, so this is a gap in coverage rather
than a known limitation, and it is listed here so nobody reads silence as
support.

---

## See also

- [Architecture](./architecture.md) — how ICE fits into the join flow
- [SFU](./sfu.md) — operating a node
- [TURN](../turn.md) — coturn configuration
