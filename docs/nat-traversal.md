# NAT Traversal — How Raven Connects Across Real Networks

This document explains the STUN → ICE → TURN → SFU flow end to end, how to
observe which path a connection actually took, and what has (and hasn't)
been verified in this local environment. For coturn's specific
configuration and operational details, see [docs/turn.md](turn.md).

## Why this is needed at all

Two peers behind NAT (nearly everyone) cannot simply dial each other's
private IP. WebRTC's ICE (Interactive Connectivity Establishment) framework
solves this by gathering multiple candidate addresses for each side and
testing which pair actually works, in decreasing order of preference:

```
NAT / firewall
      |
      v
1. host       — the client's own local address (works only on the same LAN)
2. srflx      — "server-reflexive": the client's public address as seen
                 through NAT, learned via a STUN request. Enables a
                 direct peer path once both sides know their real
                 public address/port.
3. relay      — a TURN-allocated address. Used only when no direct
                 (host or srflx) path can be established — e.g.
                 symmetric NAT, or a firewall blocking unsolicited
                 inbound UDP entirely. Every byte of media then flows
                 through the TURN server.
```

```
 Browser                          Raven Control Plane          LiveKit SFU
    |                                     |                          |
    | 1. POST /rtc-tokens  ────────────►  |                          |
    |    (mints iceServers: stun+turn+turns, all tied to             |
    |     this participant's identity and token TTL)                |
    |  ◄──────────────────────────────────|                          |
    |                                                                |
    | 2. room.connect(livekitUrl, token, { rtcConfig: { iceServers }})
    |  ──────────────────────────────────────────────────────────►  |
    |                                                                |
    | 3. ICE candidate gathering (host / srflx via STUN / relay via TURN)
    |    ICE connectivity checks — highest-priority working pair wins
    |  ◄═══════════════════════ media (SRTP) ════════════════════►  |
```

## Connection types, in Raven's terms

| Type | ICE candidate | When it's used | Cost/latency |
|---|---|---|---|
| Direct | `host` | Same LAN, or a network with no NAT in the way | Lowest latency, no relay cost |
| STUN-assisted | `srflx` | Most home/office NAT, once both sides' public address is known | Still a direct peer path — STUN is discovery-only, not on the media path |
| Relayed | `relay` | Symmetric NAT, restrictive firewalls, UDP-blocking networks | Adds coturn as an on-path hop — bandwidth cost + latency |

Raven's `iceServers` array (per token, see `turn-credential.util.ts`)
always offers all three transports so the browser's ICE agent can pick the
best working pair itself:

```json
[
  { "urls": "stun:<host>:3478" },
  { "urls": "turn:<host>:3478?transport=udp", "username": "...", "credential": "..." },
  { "urls": "turn:<host>:3478?transport=tcp", "username": "...", "credential": "..." },
  { "urls": "turns:<host>:5349?transport=tcp", "username": "...", "credential": "..." }
]
```

`<host>` is always a real, client-reachable address (`TURN_HOST`) — never
the internal Docker service name `coturn` — verified by an automated test
(`turn-credential.util.spec.ts`) asserting the string `coturn` never appears
in any generated `iceServers` entry.

## Forcing TURN-relay-only (testing NAT fallback)

`iceTransportPolicy: 'relay'` is the browser's own native WebRTC
mechanism (no custom ICE logic in Raven) — it restricts the local ICE
agent to only ever surface `relay` candidates as its own local
candidates, which forces every connectivity check (and therefore all
media) through coturn regardless of whether a direct path would have
worked. This is how Test B below is constructed.

**Not currently exposed by `@corvidhq/rtc`'s public API.** The media demo
(`examples/media-demo/`) used to have a "Force TURN relay only"
checkbox that set this by reaching directly into `livekit-client`'s
`Room.connect()` options — a capability the rewrite to Raven's actual
public SDK surface (`RTCClientConfig` only accepts `iceServers`, not an
arbitrary `RTCConfiguration`) correctly no longer exposes. Test B below
was tested directly against the SFU rather than through the demo.

## Observing connection type

**`chrome://webrtc-internals`** is the authoritative source, and now the
only one this repo uses. Inspect the active `candidate-pair` stats
(`state: succeeded`) and cross-reference the `local candidate`'s
`candidateType`.

An earlier version of the media demo also polled this itself
(`pollConnectionType()`), reaching into `livekit-client`'s undocumented
internals (`room.engine.pcManager.subscriber.pc`) to approximate the
same `RTCPeerConnection.getStats()` data every 2s. It was explicitly
documented in the code as non-authoritative even then. The rewrite to
`@corvidhq/rtc`'s actual public API dropped it rather than keep depending
on a non-public surface of the underlying media client — `@corvidhq/rtc`
has no equivalent public method, by design (spec: the SDK's own
diagnostics surface is `room.getConnectionStats()`, which reports
codec/bitrate/loss/jitter/RTT per track, not the raw ICE candidate
type). `chrome://webrtc-internals` was always the real source of truth
here; nothing lost verification capability, only a redundant,
provider-specific shortcut.

## Connectivity test matrix

Only conditions actually exercised in this environment are marked done;
everything else is honestly left unverified rather than assumed to work.

| Scenario | Status | How verified |
|---|---|---|
| Same machine, direct/STUN path (Test A) | ✅ Verified | Two real browser tabs, real camera/mic tracks, `chrome://webrtc-internals`-observable connection, both directions |
| Forced TURN-relay path, browser ↔ containerized SFU (Test B) | ❌ Cannot pass in this local topology | See [docs/turn.md#known-limitations](turn.md#known-limitations) — a Docker Desktop host/container addressing conflict, not a Raven defect |
| TURN relay *data path* itself (server-side, independent of the browser/SFU split above) | ✅ Verified | `turnutils_uclient` real two-peer relay test — 20/20 messages, 0% loss, both TCP and UDP transports (docs/turn.md#testing) |
| TURN control channel over TLS/DTLS | ✅ Verified | `turnutils_uclient -S` (TLS) and `-S -y` (DTLS) real handshakes against coturn |
| Different physical networks | ❌ Not tested | Requires two distinct real network egress points; not available in this single-host dev environment |
| UDP-restricted network (forces TCP/TLS fallback) | ❌ Not tested | Same reason — no real restrictive-network egress point available locally |
| Mobile network / carrier-grade NAT | ❌ Not tested | Requires a real mobile device on a real carrier network |
| VPN | ❌ Not tested | Not exercised in this environment |
| IPv6 | ❌ Not tested | Local Docker Compose stack does not currently exercise an IPv6 path — see [Known limitations](#known-limitations) |

This table is deliberately conservative: it does not claim Raven "supports"
any network condition beyond what was actually exercised above.

## IPv4 / IPv6

coturn's listener discovery reports `::1` as an available IPv6 relay
address in this Docker network, but no test in this environment actually
exercised an IPv6 client path — the demo, LiveKit, and every test above ran
over IPv4 only. This is an untested gap, not a confirmed limitation of the
underlying coturn/LiveKit stack, which both support IPv6 natively.

## Known limitations

See [docs/turn.md#known-limitations](turn.md#known-limitations) for the
full root-cause writeup of why the forced-TURN-relay browser test (Test B)
cannot pass against this specific local Docker Compose + Docker Desktop
setup, and why that does not indicate a defect in Raven's NAT-traversal
implementation itself.

## Production NAT-traversal checklist

- [ ] SFU (LiveKit) node IP is a single real, publicly routable address —
      not a loopback/container-split address, which is what makes Test B's
      local limitation inapplicable in production.
- [ ] TURN server (coturn) reachable on a real public hostname/IP, with
      TLS/DTLS using a CA-issued certificate (see docs/turn.md#tls).
- [ ] Firewall allows outbound UDP/TCP on the STUN/TURN control ports and
      the full relay port range, from wherever clients connect.
- [ ] A genuine forced-relay end-to-end browser test executed against the
      real production TURN + SFU deployment (not local Docker) before
      relying on TURN fallback in production — this is the one proof this
      local environment could not produce.
- [ ] Monitoring/alerting on TURN allocation failures and relay bandwidth
      (docs/turn.md#turn-usage-metrics) wired into the existing
      observability stack.
- [ ] Test across at least one real restrictive network (corporate
      firewall, or a UDP-blocked network) and one real mobile carrier
      network before considering NAT traversal production-ready — neither
      was possible in this single-host local environment.
