# Infrastructure Decisions (Phase 0 ADR)

Status: **Accepted, with one decision since reversed** — 2026-08-17

This records what technology was chosen at the start of the project and
why. Most of it still stands. **The SFU-and-signaling row does not:**
Raven now runs its own SFU on Pion and owns its signaling protocol. See
[`native-rtc-migration-map.md`](./native-rtc-migration-map.md#4-technology-decision)
for that decision and the reasoning that reversed this one.

The instruction in this document's original form was "revisit whenever a
later phase reconsiders a choice made here — do not let decisions drift
silently". The table below is annotated rather than rewritten, because a
decision record that quietly matches the present is not a record.

## Decisions

| Component | Choice | Why |
|---|---|---|
| SFU + signaling | ~~**LiveKit** (self-hosted, Apache-2.0)~~ → **Raven's own SFU on [Pion](https://github.com/pion/webrtc)**, and Raven's own signaling protocol | **Reversed.** The original reasoning — ships signaling, room/participant/token model, simulcast and server SDKs together, fastest path to a working session — was correct, and it is what got Raven to a working session. What it did not price is that owning the protocol is the only way to change the media plane without an SDK release. See `sfu-comparison.md` for the original comparison and [`native-rtc-migration-map.md`](./native-rtc-migration-map.md#4-technology-decision) for the reversal. |
| TURN/STUN | **coturn** | De facto open-source standard; engineering rule 3 mandates it; integrates as an external service alongside the SFU. Unchanged by the SFU reversal — the two were never coupled beyond the ICE candidate list. See `turn.md`. |
| Backend language/runtime | **TypeScript on Node.js** | Engineering rule 4; strong ecosystem for both the control-plane API and the SDK sharing types/tooling. |
| Backend architecture | **Modular monolith** (not microservices) | Engineering rule 3 and 7: one deployable API with clearly separated modules (Auth, Projects, Rooms, Tokens, Usage, Webhooks). Split into services only when a real scaling or ownership need forces it. |
| Primary datastore | **PostgreSQL** | Engineering rule 5; durable system-of-record for users, projects, API keys, rooms (metadata), usage records. |
| Cache / ephemeral state | **Redis** | Engineering rule 6; presence, rate limiting, room-state caching, short-lived token bookkeeping. |
| Event system (initial) | **Redis Streams** | Already have Redis in the stack; sufficient for our initial internal event volume (e.g. LiveKit webhook fan-out to Usage Service). Upgrade path to NATS or Kafka is explicitly deferred until real throughput requires it — do not pre-adopt. |
| Object storage (Phase 9+) | **S3-compatible** (AWS S3 / Cloudflare R2 in cloud, MinIO for local/self-hosted) | plan.md §12/§20: recordings must be exportable and developer-owned-storage-capable; never build custom storage. Not needed until Phase 9. |
| Observability (Phase 10+) | **Prometheus + Grafana + OpenTelemetry** | Industry-standard, self-hostable, matches LiveKit's and coturn's native metrics exporters. Not needed until Phase 10. |
| Local development | **Docker Compose** | Engineering rule 6 and Rule 4 (local-first); every *self-hosted* service (Redis, coturn, the SFU, MinIO, API, dashboard) must run with `docker compose up -d`. |
| Postgres hosting | **Managed (Supabase)**, not a container | The one exception to local-first above. Postgres is the system of record: a per-developer container meant per-developer schema drift and a `docker compose down -v` away from losing it, and the production database needed backups and a connection pooler we were not going to build. Supabase supplies managed Postgres and nothing else — no SDK, no Auth, no REST; Prisma + `pg` talk to it exactly as they did to the container. See `docs/deployment/managed-postgres.md`. |
| Production deployment (Phase 11+) | **VMs + Terraform**, not Kubernetes | Engineering rule 9 and Rule 3: Kubernetes is explicitly deferred until there's a real operational requirement it solves that Terraform-managed VMs can't. |
| Regions | **Single region** at launch | Engineering rule 10: no multi-region infrastructure before product validation (Phase 15 is post-PMF work). |

## What we are explicitly not building (reaffirmed from plan.md §33)

Our own WebRTC stack, our own codec, our own object storage, our own
database, our own payment processor, our own TURN protocol, a Kubernetes
replacement, dozens of SDKs, or global infrastructure ahead of demand.
Our engineering effort goes into: the control plane, the developer SDK,
the dashboard, documentation, and cost/DX optimization on top of the
infrastructure above — not into reimplementing what LiveKit/coturn/Postgres/
Redis already solve.

## Consequence for the phase roadmap

Because LiveKit subsumes signaling, `INFRASTRUCTURE_PHASES.md` Phases 3
("Signaling") and 4 ("SFU") are executed as one combined integration phase
in practice, even though we'll keep them as separate checkpoints for
clarity of "done" criteria (token issuance working vs. multi-participant
media working). No other phase's scope changes as a result of this
decision.

## Revisiting this document

This ADR should be revisited (not silently overridden) if:
- LiveKit's self-hosted operational cost or licensing terms change
  materially,
- Cost or routing-control requirements (Phase 16 onward) can't be met
  through LiveKit's configuration surface, in which case mediasoup is the
  documented fallback (`sfu-comparison.md`),
- Real production load makes Redis Streams insufficient for the event
  system, in which case NATS is the next step, Kafka after that.
