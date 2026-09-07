# SFU Comparison and Decision

> **Superseded — historical record.** This document records the Phase 1–6
> decision to build on LiveKit. Raven has since moved to its own SFU on
> Pion; see
> [`native-rtc-migration-map.md`](./native-rtc-migration-map.md#4-technology-decision)
> for the current decision and the reasoning that reversed this one. The
> comparison below is kept because it is *why* LiveKit was the right call at
> the time, and because the trade-off it knowingly accepted ("LiveKit owns the
> signaling protocol and much of the media-routing decision logic") is exactly
> what the migration undoes. LiveKit references in this file are intentional
> and historical — they describe no runtime dependency.

## Candidates evaluated

| | LiveKit | mediasoup | Pion |
|---|---|---|---|
| What it is | Full SFU server + signaling protocol + room/participant/token model + server & client SDKs | Node.js/C++ library providing workers/routers/transports — not a server on its own | Go WebRTC *library* (ICE/DTLS/SRTP/SCTP) — not an SFU at all |
| Signaling | Built in (its own WebSocket protocol, SDP/ICE handled internally) | None — you build your own signaling server | None — you build everything |
| Room/participant/track model | Built in, maps directly onto our Room/Participant concepts | You design and build this yourself on top of the primitives | You design and build everything yourself |
| Auth model | JWT access tokens with scoped grants (room, publish, subscribe, admin) — very close to what our Token Service already needs to produce | None — you build it | None — you build it |
| Self-hosting | Yes, Apache-2.0, `docker compose up` friendly | Yes, but you're hosting your own signaling server too | N/A — not a deployable server |
| Simulcast / adaptive bitrate | Built in | Built in (lower-level control) | Not implemented — you'd build it |
| Engineering effort to first working room | Low — mostly integration + token issuance | Medium-high — full signaling server + mediasoup integration | Very high — building an SFU from a transport library |
| Control over media routing internals | Low (config-level control; LiveKit owns the routing logic) | High (you write the routing/selection logic) | Total (you write everything) |
| Maturity / community | Widely deployed, active development, used by many RTC-as-a-service builders | Widely deployed, mature, used inside many custom platforms (e.g. early Discord-style stacks) | Mature as a *library*; not commonly used as a turnkey SFU foundation |

## Decision: LiveKit

**Chosen for the Phase 1–6 foundation.**

Rationale:
1. Rule 2 (do not build WebRTC from scratch) and Rule 3 (start simple) both
   point the same direction: LiveKit gets us to "two browsers in a room"
   fastest, with the least custom code to secure and operate.
2. LiveKit's room/participant/token model already matches what plan.md's
   Room Service and Token Service need to expose — our control plane
   becomes a thin, opinionated layer in front of LiveKit's server APIs
   rather than a from-scratch design.
3. It is Apache-2.0 and self-hostable, which preserves the
   no-vendor-lock-in / self-hosting commitment in plan.md §19–20.
4. Simulcast and adaptive bitrate — both explicit cost/quality levers in
   plan.md §18 — are already implemented and battle-tested.

Trade-off accepted knowingly: LiveKit owns the signaling protocol and much
of the media-routing decision logic. This means our "Signaling" phase
(Phase 3) is much thinner than it would be with mediasoup — see
`signaling.md` (also a decision record). If, later, cost or routing control requirements outgrow
what LiveKit's configuration surface allows, mediasoup remains the
documented fallback (this is why we evaluated it in depth rather than
skipping straight to LiveKit).

## Explicitly not chosen for MVP

- **mediasoup** — kept as the documented Plan B if we need lower-level
  routing control later (e.g. highly custom cost-optimized regional
  routing in Phase 16). Revisit only after real production usage data
  justifies the extra engineering cost of owning a signaling server.
- **Pion** — too low-level to be a Phase 1 foundation. Remains relevant only
  as a building block for possible future custom RTC components
  (e.g. a bespoke recording egress or a specialized media processor), not
  as the SFU itself.
- **Cloudflare Realtime SFU** — evaluated per plan.md §8 but rejected for
  the initial foundation because it is a hosted-only product, which
  conflicts with the self-hosting/no-lock-in commitment. Worth revisiting
  as an *additional* regional option in Phase 15 (multi-region), not as
  the core.
