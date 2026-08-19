# Telemetry — what `@corvidhq/rtc` reports, and how

Best-effort connection telemetry from the browser SDK to the Control API,
feeding the dashboard's Observability tabs and the `raven connections`/
`raven errors` CLI commands. This is the "Raven Telemetry API" from the
Phase 9 architecture.

## Core rule: telemetry never affects RTC

**RTC must keep working even if telemetry is completely broken.** Every
`send()` call is fire-and-forget: it is never awaited by `join()` or by
any event handler, every failure (network error, non-2xx, synchronous
throw) is caught and swallowed, and there is no retry queue that could
build up backpressure. A telemetry outage degrades observability data —
it never degrades a call. This is enforced by tests in
`packages/sdk/test/client.spec.ts` and `packages/sdk/test/telemetry.spec.ts`
(including a test that a real `join()` succeeds while `fetch` is
mocked to always reject).

## Authentication

Telemetry reuses the same RTC (LiveKit) token issued for the connection
itself — there is no separate telemetry credential to mint, store, or
leak. The Control API's `POST /v1/telemetry/events` verifies that token
with the same verifier the signaling layer uses (`RtcTokenVerifierService`)
and derives `projectId`/`roomId`/`participantIdentity` from its signed
claims — nothing the client asserts in the request body about those is
trusted.

## Transport

`createRTCClient({ token, endpoint, iceServers, telemetryUrl })` —
`telemetryUrl` is the same token-mint response field as `endpoint`/
`iceServers`, never hand-constructed. Every event is a small JSON POST
to `<telemetryUrl>/v1/telemetry/events` with `keepalive: true` (so the
final "disconnected" event has a real chance to complete during a page
unload). `navigator.sendBeacon` isn't used — it can't carry the
`Authorization` header this endpoint requires.

## Disabling telemetry

```js
createRTCClient({ token, endpoint, telemetry: false });
```

`connectionId` is still generated locally either way (see below) — it's
part of the SDK's own public API, not telemetry infrastructure. With
`telemetry: false`, `fetch` is never called at all.

## Event types

One flat vocabulary, not one endpoint per event kind:

`connection_started`, `connected`, `reconnecting`, `reconnected`,
`disconnected`, `connection_failed`, `ice_state_changed`,
`signaling_state_changed`, `participant_joined`, `participant_left`,
`participant_reconnected`, `participant_connection_failed`,
`participant_connection_quality_changed`, `track_published`,
`track_unpublished`, `error`.

The SDK currently emits: `connection_started` (at `join()`), `connected`/
`reconnecting`/`reconnected`/`disconnected`/`connection_failed` (from
`Room`'s connection-state machine), `participant_joined`/`participant_left`,
`track_published`/`track_unpublished` (local tracks only), and `error`
(with the `RTCError` code/message attached).

## What's collected

Per event: `connectionId`, `type`, a timestamp, and a small `data` bag —
`sdkVersion`, `platform`/`browser` (coarse, parsed from `navigator.userAgent`,
never a fingerprinting library), and event-specific fields (e.g. an
error's `code`/`message`, a participant's identity).

**Never collected:** raw audio/video, message contents, passwords, API
secrets, TURN credentials, private keys, or any full RTC token.
`region`/`networkType` are only ever what the browser's own standard APIs
expose (`navigator.connection?.effectiveType`) — never geo-IP lookups.

## Connection quality / WebRTC stats

**Known limitation:** this phase does not poll `RTCPeerConnection.getStats()`
or LiveKit's `ConnectionQuality` events for periodic RTT/jitter/packet-loss/
bitrate summaries. `Room.getDiagnostics()`'s `iceConnectionState`/
`signalingState` fields are present in the type but `undefined` today —
honest about what isn't wired up yet, rather than fabricated. This is the
natural next increment on top of this phase's event pipeline.

## Sampling and performance

There is no periodic/high-frequency telemetry in this phase (no stats
polling — see above), so there was nothing to sample or batch: every
event maps to a real, discrete state transition, not a fixed-interval
tick. This keeps the current implementation inherently lightweight
(one small POST per real event, never per video frame or WebRTC stat).

## Client-side diagnostics

```js
const diagnostics = room.getDiagnostics();
// { connectionState, iceConnectionState, signalingState, reconnectCount, sdkVersion, platform, browser }
```

Never includes a token or any secret — safe to print or attach to a bug
report as-is. `client.getDiagnostics()` delegates to the currently
joined room's, and throws before `join()`.

## Privacy

See `docs/observability.md#privacy` for the full data model, retention,
and what's collected server-side.
