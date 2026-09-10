# TURN Infrastructure (coturn)

> **Decision record.** Why coturn, and what it was configured to do. This
> decision was *not* reversed by the move to Livqeno's own SFU: coturn is
> still the TURN server, still authenticated with ephemeral HMAC
> credentials, still a separate deployable unit. For how TURN works in
> practice today — ports, firewall rules, forcing a relay path, diagnosing
> a failure — read [`../rtc/networking.md`](../rtc/networking.md).

## Why we need TURN

STUN alone lets peers discover their public address, but roughly 10-20% of
real-world networks (symmetric NAT, locked-down corporate/school firewalls,
some mobile carrier NATs) cannot establish a direct peer path even with
that information. In those cases, media must be relayed through a TURN
server. Unlike STUN, TURN sits **on the media path** — every relayed byte
of audio/video flows through it — so it is both an availability requirement
and a direct cost center we must monitor and optimize (plan.md §18).

## Technology decision

**coturn**, per engineering rule 3. It is the de facto standard open-source
TURN/STUN server, used in production by essentially every WebRTC
platform. Livqeno does not implement the TURN protocol itself and has no
plans to — this is the one part of the media path where "use the standard
implementation" is unambiguously right.

## How it fits with the SFU

The SFU embeds no TURN server of its own, and that is deliberate rather
than a gap: an SFU that also relays is two capacity problems sharing one
process, and coturn needs to scale and fail independently of the media
plane. Clients are handed `iceServers` when their RTC token is minted, so
coturn's address and credentials reach the client from the control plane
rather than from the SFU.

```
Client
  |
  +------ direct (host / STUN-derived candidate) ------> Livqeno SFU
  |
  +------ relayed ------------------------------------> coturn --> Livqeno SFU
```

This shape survived the migration unchanged, which is the useful thing to
know about it: replacing the SFU did not require touching TURN, because
the two were never coupled beyond the ICE candidate list.

## Configuration surface for Phase 1 (local dev)

- **Transports:** UDP (preferred, lowest overhead), TCP (fallback for
  UDP-blocked networks), TLS (`turns:`) for networks that only allow
  outbound 443/TLS traffic.
- **Authentication:** time-limited (short-lived) credentials generated via
  a shared secret (coturn's `use-auth-secret` / REST API mechanism), not
  static long-lived username/password pairs. The RTC Token Service is the
  one component allowed to mint these, in step with RTC access tokens —
  implemented in `turn-credential.util.ts` and documented in
  [`../rtc/networking.md#turn`](../rtc/networking.md#turn), verified
  directly against a running coturn instance before being wired in.
- **Credential rotation:** shared secret lives in environment/secret
  storage, never in source control; rotating it invalidates future
  credential generation without needing to touch already-connected
  sessions.
- **Port ranges:** a bounded relay port range (rather than the OS-wide
  ephemeral range) so it's firewallable and predictable in Docker/VM
  network rules.
- **Bandwidth limits:** per-allocation bandwidth caps are configurable in
  coturn and matter directly for cost control once real usage starts —
  revisit concrete limits in Phase 16 (Cost Optimization) once we have
  real traffic data, not before.

## What we track (from Phase 5 / Phase 10 onward, not Phase 0)

Allocations, relayed traffic volume, active TURN sessions, connection
errors, and bandwidth — all feed the Usage Service (billing input) and
observability stack (operational health input). Phase 0 only needs to
establish that this data exists and is exposed by coturn (via its Prometheus
exporter / control-port stats); wiring it up happens in later phases.

## Definition of done for this document

Anyone on the team can answer: "why do we need a relay server if STUN
already tells you your public IP?" — because STUN is discovery-only and
some networks block direct connectivity outright, requiring an
on-path relay. coturn is that relay, and it operates independently of,
but alongside, the SFU.
