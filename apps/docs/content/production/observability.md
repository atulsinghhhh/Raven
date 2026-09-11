---
title: Observability
description: Real connection history, real diagnostics — never fabricated, never infrastructure internals.
---

Every error and connection Livqeno shows you is a **Livqeno concept** — never
a raw SFU, TURN, or database error surfaced directly. That
translation happens in one place server-side (see
[Error Codes](/reference/errors)), so a developer never has to learn a
dependency's error vocabulary to understand their own application.

## What's tracked

- **Connections** — one row per RTC participant session:
  state, region, SDK version, platform, reconnect count, and — once a
  client reports them — real media-quality stats (RTT, jitter, packet
  loss, bitrate, codec). See [Diagnostics](/rtc/diagnostics).
- **Errors** — classified into a Livqeno-facing category
  (`TOKEN_ERROR`, `ICE_ERROR`, `TURN_ERROR`, ...) with a plain-language
  likely cause and suggested action, always hedged rather than stated as
  certain.
- **Chat connections** — WebSocket sessions, their gateway, and message
  throughput, without ever exposing message content in the dashboard's
  overview.
- **Audit log** — administrative actions. See
  [Audit Logs](/production/audit-logs).

## How connection data arrives

`@ravenkash/rtc` best-effort POSTs telemetry events to `/v1/telemetry/events`,
authenticated with the same RTC token the client already holds. This is
deliberately never able to affect the call it's describing:

- Fire-and-forget — no caller ever awaits a telemetry send.
- Every failure (network error, non-2xx, unreachable endpoint) is
  swallowed at the SDK level.
- A malformed individual event fails that one ingest request; it never
  touches the connection it's describing.

## Health checks

`/health` reports `ok` only when every real dependency — Postgres,
Redis, the SFU, TURN — actually responds, each bounded by a timeout so a
hung dependency degrades the health check rather than hanging it
indefinitely. A health check that hangs is worse than one that honestly
reports a fault.

## Retention

Connection and error history isn't kept forever. Configure retention per
your own compliance needs; the default favors debugging a recent
incident over storing everything indefinitely.

## Privacy

Message content is never included in the developer-facing observability
surface. `raven chat conversations` and the dashboard's chat views show
counts, participants, and timestamps — never text. The CLI states this
explicitly in its own output rather than silently omitting the field.

## What's not built yet

There's no alerting layer — Livqeno records the data; wiring it to PagerDuty
or Slack is presently on you, via the REST API or webhooks. Stated
plainly rather than implied, per this project's own standard for
documenting what exists.
