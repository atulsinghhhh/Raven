# Livqeno on Kubernetes

## What's here

`base/` deploys `apps/api` — the whole thing: REST control plane, chat
gateway, signaling gateway, and the webhook delivery worker, all in one
`Deployment` — because that's what the code actually is today: one
`AppModule`, one `main.ts` entrypoint, one process. Every replica is
safe to run concurrently without any of this manifest set coordinating
them:

- **Chat** and **signaling** fan out over Redis pub/sub with a
  connection registry (no sticky sessions) — see `docs/chat/architecture.md`
  and `docs/signaling.md`'s "Multi-instance readiness" section (added
  this pass — signaling used to be the one component that couldn't run
  more than one instance of; it isn't anymore).
- **Webhook delivery** coordinates via a Redis `SET NX EX` lock so only
  one replica drains the queue at a time regardless of replica count.
- **The database pool** (`prisma.service.ts`) is sized per-pod via
  `DATABASE_POOL_MAX` — N replicas × that value is the real ceiling on
  how far `replicas`/the HPA's `maxReplicas` can go before Postgres's
  own `max_connections` becomes the bottleneck. See
  `docs/production/capacity-report.md` for the measured numbers.

Resource requests/limits and the HPA's utilization targets are
placeholders, marked as such in each manifest — they're sized
conservatively, not from measurement. `docs/production/capacity-report.md`
is where the real numbers come from; revisit these files once that
exists.

## What's deliberately not here

- **Postgres, Redis, the Livqeno SFU, coturn.** Their production topology
  (replication/failover, Sentinel/Cluster, a real TURN relay behind
  NAT) needs infrastructure this pass didn't have access to — tracked
  as P1 in `docs/production/capacity-report.md`. `docker-compose.yml`
  is still the source of truth for what these need to look like
  locally; don't hand-author manifests for them here without that infra
  to actually test against.
- **Real secrets.** `api-secret.yaml` is a placeholder documenting the
  *shape* apps/api needs (every key it reads from `process.env` — see
  `shared/config/configuration.ts`), not something to `kubectl apply`
  as-is. Replace it with an ExternalSecret or SealedSecret before any
  real deployment.
- **Distributed tracing, alerting rules, a Prometheus Adapter for
  connection-count-based autoscaling.** All P1 — they need a tracing
  backend / Alertmanager / Prometheus Adapter this pass didn't stand
  up. The application side (OpenTelemetry-ready boundaries, the
  `/metrics` gauges an adapter would read) is either already in place
  or documented as the next step.
- **Sustained chaos testing, penetration testing.** P2 — both need a
  real multi-node cluster under real traffic over days, not something a
  single local session can produce credible evidence for.

## Target topology (not built this pass)

The natural next step, once there's a reason to scale chat/signaling
independently from REST traffic: split `main.ts`'s bootstrap on a
`RAVEN_ROLE` env var so `api-http` (stateless REST, HTTP-only ingress),
`chat-gateway` and `signaling-gateway` (WS-only, their own HPA curve
driven by connection count once the Prometheus Adapter above exists),
and `webhook-worker` (no code change needed — the Redis lock already
makes N replicas safe) become separate `Deployment`s with independent
rollout cadences. This is a `main.ts` bootstrap change, not a repo
restructure, and the module boundaries already support it — nothing
about the fix in this pass (signaling's Redis-backing) assumed a single
process.

The SFU fleet and coturn get their own load-balanced paths in that topology
too (UDP/TCP media, not the HTTP ingress) — already implied by
`docker-compose.yml`'s `50000-50019/udp` port range.

## Validating these manifests

No real cluster was available this pass — validation is structural
only (`kubectl --dry-run=client`, which checks manifests against the
Kubernetes OpenAPI schema without needing a live cluster):

```sh
kubectl kustomize infrastructure/k8s/base | kubectl apply --dry-run=client -f -
```

Deploying and load-testing against a real cluster is what would turn
these from "structurally valid" into "actually works" — not done here.
