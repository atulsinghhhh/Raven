# Observability

Raven's first production-oriented observability layer (Phase 9): answer
"is my project working, and if not, why?" without ever needing to touch
LiveKit or coturn directly. See also `docs/telemetry.md` (what the SDK
reports and how), `docs/diagnostics.md` (the two diagnostic surfaces),
and `docs/error-codes.md` (error categories and explanations).

## Core principle: Raven concepts, never infrastructure internals

A developer sees `TURN_ERROR` / `"Likely cause: a firewall/NAT
restriction"` — never a raw LiveKit ICE candidate error code or a coturn
allocation failure. Internal infrastructure detail stays out of every
developer-facing surface (dashboard, CLI, API responses); `error-classifier.ts`
is the one place that maps SDK-reported errors onto Raven's own vocabulary.

## Architecture

```
RTC Client (@corvidhq/rtc)
    │  best-effort, fire-and-forget events (never blocks RTC)
    ▼
POST /v1/telemetry/events   — authenticated by the same RTC token
    │
    ▼
ConnectionsService  ──creates/updates──▶  Connection (+ ConnectionEvent timeline)
    │                                          │
    └── type: 'error' ──classifies──▶ ErrorEvent (category, likelyCause, suggestedAction)
    │
    ▼
PostgreSQL (existing database — no new datastore)
    │
    ├── MetricsService    — real-time aggregation over the Connection/ErrorEvent tables
    ├── DiagnosticsService — authenticated per-dependency status + active-connection count
    └── RetentionService   — periodic sweep, deletes rows past their configured age
    │
    ▼
Dashboard (Connections / Errors / Diagnostics tabs)  +  CLI (`raven connections`/`errors`/`diagnostics`)
```

Modular by construction: `ConnectionsService`/`ErrorsService`/`MetricsService`
are the only things that touch the Prisma models directly — a future
swap to a dedicated metrics backend (e.g. Prometheus for the aggregate
counters) would only need to change what's behind those three services,
not the controllers, CLI, or dashboard.

## Data model

Three new tables (`apps/api/prisma/schema.prisma`), alongside the
existing `Project`/`Room`/`Participant`/`RtcToken`:

- **`Connection`** — one row per real RTC connection, keyed by a
  client-generated `publicId` (`conn_...`, Phase 9 spec §8). Tracks
  lifecycle state (`CONNECTING → CONNECTED ⇄ RECONNECTING → DISCONNECTED`/
  `FAILED`), timestamps for each transition, `reconnectCount`, and
  developer-safe metadata (`sdkVersion`, `platform`, `browser`, `region`,
  `networkType`).
- **`ConnectionEvent`** — the append-only timeline behind a connection's
  detail view; every event ingested, in order, never mutated.
- **`ErrorEvent`** — a classified error (`publicId` `err_...`), linked to
  its `Connection` when one exists, with `category`/`likelyCause`/
  `suggestedAction`.

No new database technology — same PostgreSQL via Prisma as everything
else. Every ID surfaced to a developer (dashboard, CLI, error report) is
the public one (`conn_...`/`err_...`), never an internal database uuid —
enforced by re-serializing through the related row rather than returning
Prisma's raw foreign-key column (see `ErrorsService`).

## Connection lifecycle

```
connecting → connected → reconnecting → connected   (recovered)
connecting → failed                                  (never connected)
connected → disconnected                             (clean exit)
```

Every transition is a real `ConnectionEvent` row with its own timestamp —
`raven connections inspect <id>` and the dashboard's connection detail
page render this as a timeline, e.g.:

```
1:04:06 PM  connection_started
1:04:06 PM  connected
1:04:35 PM  disconnected
```

## Metrics

`GET /v1/projects/:projectId/metrics?range=15m|1h|24h|7d` computes, from
real rows only:

- `activeRooms` / `activeParticipants` — distinct rooms/participants among
  connections currently in a non-terminal state.
- `connections` — how many started within the requested range.
- `connectionSuccessRate` — % of those that ever reached `connected`.
- `reconnectionRate` — % that reconnected at least once.
- `averageConnectionDurationMs` — average of `durationMs` among finished connections.
- `errors` — count of classified errors within the range.

Every field is `null`/`0` for a project with no data — **never a
fabricated percentage** (Phase 9 spec §36). This backs the dashboard's
Observability overview cards and the time-range selector (15 minutes /
1 hour / 24 hours / 7 days).

## Health checks

The existing public `/health` (unauthenticated, Phase 5/7) already
distinguishes Database/Redis/SFU(LiveKit)/TURN and aggregate signaling
counts — left unchanged (deliberately minimal, since it's commonly
reachable without auth). The new authenticated `GET /v1/projects/:projectId/diagnostics`
adds a project-scoped view with the project's own real active-connection
count — see `docs/diagnostics.md`.

## Retention

MVP defaults (configurable via env vars, `RetentionService`):

| Data | Default retention | Env var |
|---|---|---|
| Connections (+ their event timeline, cascade-deleted) | 30 days | `OBSERVABILITY_CONNECTION_RETENTION_DAYS` |
| Errors | 30 days | `OBSERVABILITY_ERROR_RETENTION_DAYS` |
| Sweep interval | 1 hour | `OBSERVABILITY_RETENTION_SWEEP_INTERVAL_MS` |

Implemented as a plain `setInterval` sweep (same pattern as the existing
signaling gateway's heartbeat) rather than a new cron dependency — see
`RetentionService.sweep()`. Deleting a `Connection` cascades its
`ConnectionEvent` rows; an `ErrorEvent` can outlive the connection it
happened on (its `connectionId` is nulled, not deleted) since errors have
their own, independent retention window.

## Privacy

**Collected**: connection lifecycle events and timestamps, developer-safe
metadata (SDK version, coarse platform/browser, region/network type if
the browser exposes it), classified error category + message, and the
project/room/participant identifiers already used elsewhere in the
control plane.

**Never collected**: raw audio/video, message contents, passwords, API
key secrets, RTC tokens, TURN credentials, private keys. See
`docs/telemetry.md#what-s-collected` for the full list and
`docs/telemetry.md#disabling-telemetry` for `telemetry: false`.

## Security / redaction

- Telemetry ingestion is authenticated by the same signed RTC (LiveKit)
  token the connection itself uses — verified server-side, never trusted
  from the request body.
- Every ID returned anywhere (dashboard, CLI, API JSON) is the public
  `conn_.../err_...` one, never an internal database uuid.
- `--debug` CLI output for every new command was verified live to never
  include the bearer token, an API key, or a response body (the HTTP
  client only ever debug-logs the request path/body and response status
  — see `docs/cli.md#debug-mode`).
- Automated tests cover: telemetry-failure-never-breaks-RTC (SDK), guard
  rejection of an invalid/missing RTC token, cross-project authorization
  boundaries (an intruder gets 404 on another project's connections/
  errors/metrics/diagnostics), and the connectionId-not-uuid serialization
  fix caught during this phase's own testing.

## Alerting foundation (not built yet)

This phase computes the real-time numbers a future alerting system would
threshold against (connection failure rate, error rate, reconnection
rate) but does not implement notifications, webhooks, or threshold
configuration — deliberately out of scope (Phase 9 spec §28/§35).

## Known limitations

- No raw WebRTC statistics (RTT, jitter, packet loss, bitrate) —
  see `docs/telemetry.md#connection-quality--webrtc-stats`.
- `Room.getDiagnostics()`'s `iceConnectionState`/`signalingState` are
  always `undefined` today — the LiveKit adapter doesn't expose them yet.
- Metrics aggregation uses in-memory dedup over `findMany` results rather
  than SQL `GROUP BY` — correct and simple at this phase's scale; a
  higher-volume deployment would want real SQL aggregation.
- No alerting/notification delivery (see above).
