---
title: Telemetry & privacy
description: What the client SDKs report, what they never report, and how to switch it off.
---

`@corvidhq/rtc` reports connection telemetry so the dashboard, the CLI and
[Diagnostics](/rtc/diagnostics) can show what happened on a call that has
already ended.

## What is sent

Eleven event types, all of them structural:

| Event | When |
|---|---|
| `connection_started` | `join()` was called |
| `connected` | The room finished joining |
| `connection_failed` | The join did not complete |
| `reconnecting` / `reconnected` | An automatic reconnect |
| `participant_joined` / `participant_left` | Someone else's presence changed |
| `track_published` / `track_unpublished` | Someone else's track set changed |
| `stats` | Per-track bitrate, packet loss, jitter, RTT, codec, resolution, frame rate |
| `error` | A typed `RTCErrorCode` and its message |

Plus SDK version, platform and browser, attached to the connection.

## What is never sent

- **No media.** No audio, no video, no frames, no samples.
- **No message content.**
- **No credentials.** Not the token, not TURN credentials, not an API key.
- **No IP addresses collected by the SDK.** The API sees the source address
  of the request, as any HTTP server does.

The `getDiagnostics()` payload is deliberately safe to paste into a bug
report. That is a design constraint on what telemetry may contain, not a
coincidence.

## How it is authenticated

Telemetry POSTs to `/v1/telemetry/events` using the **same RTC token** the
connection already holds. There is no separate credential, and telemetry
cannot reach anything the token could not.

The address comes from `telemetryUrl` in the mint response. The SDK never
hardcodes a host.

## It never blocks a call

Telemetry is best-effort. A failed telemetry request is dropped, not
retried into the media path. If the endpoint is unreachable the call is
unaffected.

## Switching it off

```ts
const client = createRTCClient({
  token, endpoint, iceServers,
  telemetry: false,
});
```

Or simply do not forward `telemetryUrl`. RTC never depends on it either way.

The cost of switching it off: connection history and error classification
stop appearing for those clients, in the dashboard, in `raven connections
inspect`, and in `raven errors list`. Nothing else changes.

## Retention

Connection and error records are swept after 30 days by default —
`OBSERVABILITY_CONNECTION_RETENTION_DAYS` and
`OBSERVABILITY_ERROR_RETENTION_DAYS`.

## Related

- [Diagnostics](/rtc/diagnostics) — the same data, live and client-side.
- [Connection](/concepts/connection) · [Observability](/production/observability)
