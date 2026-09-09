---
title: Health & metrics
description: What to probe, what to scrape, and why liveness and readiness are deliberately different endpoints.
---

## Three endpoints

| Endpoint | Auth | Answers |
|---|---|---|
| `GET /health/live` | None | Is this process able to respond at all? |
| `GET /health/ready` | None | Should traffic be routed here right now? |
| `GET /metrics` | None | Prometheus scrape |

`GET /health` is an alias of `/health/ready`, kept so existing load
balancers did not have to change the day the split shipped.

## Liveness makes no dependency calls

On purpose. If liveness probed Postgres, a database outage would make an
orchestrator decide every *process* was broken and restart them — swapping
a healthy pod that cannot reach a dependency for another healthy pod that
also cannot reach it.

If the handler runs at all, the event loop is not wedged. That is the one
thing liveness is meant to answer.

```
GET /health/live  →  200 {"status":"ok"}
```

## Readiness probes everything

```json
{
  "status": "ok",
  "dependencies": { "database": "up", "redis": "up", "sfu": "up", "turn": "up" },
  "signaling": { "activeConnections": 2, "activeRooms": 1, "activeParticipants": 2 }
}
```

`503` with `"status": "degraded"` when any dependency is down, and the
response names which:

```json
{ "status": "degraded", "dependencies": { "database": "up", "redis": "down", "sfu": "up", "turn": "up" } }
```

Wire this to your load balancer, not liveness. The two actions —
stop routing, and restart — are materially different, and readiness is the
one you want almost always.

## Metrics

```bash
curl http://localhost:4100/metrics
```

Keep `/metrics` off your public ingress. It is an operations surface, not
part of the developer-facing API, and it is excluded from the OpenAPI
document for that reason. Scrape it pod-internally.

### Control plane

| Metric | Type | Covers |
|---|---|---|
| `raven_http_requests_total` | counter | Requests by route, method, status |
| `raven_http_request_duration_seconds` | histogram | Latency |
| `raven_chat_connections_active` | gauge | Live chat sockets |
| `raven_chat_subscribed_rooms` | gauge | Room subscriptions |
| `raven_chat_subscribed_channels` | gauge | Channel subscriptions |
| `raven_signaling_connections_active` | gauge | Live signaling sockets |
| `raven_signaling_rooms_active` | gauge | Rooms with participants |
| `raven_signaling_participants_active` | gauge | Participants across all rooms |
| `raven_rtc_node_links_active` | gauge | Live links to media servers |
| `raven_rtc_node_link_sessions` | gauge | Sessions across those links |

### SFU

Scraped from the SFU's own port, not the API's:

| Metric | Covers |
|---|---|
| `raven_sfu_active_rooms` | Rooms this node is serving |
| `raven_sfu_participants_joined_total` / `_left_total` | Participant churn |
| `raven_sfu_rooms_created_total` | Rooms allocated |
| `raven_sfu_tracks_published_total` / `_unpublished_total` | Track churn |
| `raven_sfu_negotiations_started_total` / `_failures_total` | Negotiation health |
| `raven_sfu_connections_succeeded_total` / `_failed_total` | ICE/DTLS outcomes |
| `raven_sfu_layer_switches_total` | Simulcast layer changes |
| `raven_sfu_keyframes_requested_total` | Recovery pressure |

## What to alert on

Rates and ratios, not single events. One failed call is a bad network.

- `raven_sfu_connections_failed_total` **rising as a share** of
  `_succeeded_total` — usually TURN or a firewall.
- `raven_sfu_negotiation_failures_total` climbing at all — this should be
  near zero.
- `raven_signaling_participants_active` flat at zero while HTTP traffic
  continues — signaling is unreachable even though the API is up.
- Readiness flapping — a dependency is marginal rather than down.
- `raven_sfu_keyframes_requested_total` spiking — loss is forcing recovery.

## From the terminal

```bash
raven status              # dependency health, same data as /health/ready
raven status --json | jq -r '.dependencies.database'
raven diagnostics         # is the whole stack reachable from the API
raven errors list         # classified failures with likely causes
raven connections list    # what connected and how it ended
```

## Logs

Structured JSON via pino, one guaranteed line per request carrying the
correlation id that error bodies also return as `requestId`. Set the level
with `LOG_LEVEL` (`trace`…`fatal`); everything else about the shape is
fixed so aggregators can parse fields rather than regex lines.

No credential is ever logged, at any level.

## Next steps

- [Observability](/production/observability) — the developer-facing view.
- [Production checklist](/production/checklist) · [Running the SFU](/self-hosting/sfu)
