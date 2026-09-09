---
title: Connection
description: The record of one client's session. What Raven knows about a call after it happened.
---

A connection is the stored record of one client joining one room: when it
started, how it ended, and what went wrong.

## Why it exists

A call that failed is the one you need to debug, and by then the client is
gone. The connection record is what remains — the state machine it went
through, the errors it reported, and the media stats its SDK sent.

## Not a live object

There is no "connection" in the SDK. It is an observability record, read
after the fact:

```ts
const connections = await raven.connections.list({ state: 'FAILED' });
const detail = await raven.connections.get(connections[0].id);
```

```bash
raven connections list
raven connections inspect <connectionId>
```

## States

```
CONNECTING → CONNECTED → DISCONNECTED
     │            │
     │            └→ RECONNECTING → CONNECTED
     └→ FAILED
```

## Where the data comes from

The client's SDK reports it, best-effort, to the telemetry endpoint using
the same RTC token it already holds. Telemetry never blocks a call and can
be switched off with `telemetry: false`.

So a connection record can be incomplete — a browser tab closed mid-call
sends nothing more. Missing data is reported as missing rather than
inferred. See [Telemetry & privacy](/backend/telemetry).

## Retention

Connection and error records are swept after 30 days by default
(`OBSERVABILITY_CONNECTION_RETENTION_DAYS`).

## Related

- [Diagnostics](/rtc/diagnostics) — the live, client-side view.
- [Observability](/production/observability) · [Observability API](/api/observability)
