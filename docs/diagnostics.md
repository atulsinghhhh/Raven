# Diagnostics

Two distinct diagnostic surfaces, deliberately kept separate because
they answer different questions with different guarantees:

## 1. Project diagnostics (server-side, authenticated)

`GET /v1/projects/:projectId/diagnostics` (JWT-guarded) — a project-scoped
superset of the public `/health` endpoint (`docs/observability.md#health-checks`),
plus the project's own real active-connection count:

```json
{
  "project": { "id": "...", "name": "my-video-app" },
  "api": "up",
  "authentication": "ok",
  "dependencies": { "signaling": "up", "sfu": "up", "turn": "up" },
  "connections": { "active": 2 }
}
```

`api`/`authentication` are trivially `"up"`/`"ok"` — reaching this
endpoint at all already proves both. Reachable via:

- `raven diagnostics` (see `docs/cli.md#diagnostics`)
- Dashboard → a project's Diagnostics view (surfaced alongside Connections/Errors)

## 2. Client-side connection diagnostics (in the browser, per connection)

```js
const diagnostics = room.getDiagnostics();
// { connectionState, iceConnectionState, signalingState, reconnectCount, sdkVersion, platform, browser }
```

This can **only** come from an actual running `@corvidhq/rtc` client with a
live (or recently live) connection — a CLI process or a server has no
way to know a specific browser's ICE state, and Raven never fabricates
it. `raven diagnostics` explicitly does not attempt to show this data;
it points to `room.getDiagnostics()` instead. See `docs/telemetry.md#client-side-diagnostics`.

## Why not one combined command

An earlier draft of this phase's spec showed a single `raven diagnostics`
example mixing both (API/Auth/Signaling/TURN/Project *and* ICE/Browser/SDK
version). In practice those come from two different processes that don't
share memory — a CLI running in a terminal cannot see the ICE state of a
browser tab across the network. Rather than fabricate the browser half,
`raven diagnostics` reports only what it can honestly know, and documents
`room.getDiagnostics()` as the real source for the rest.

## Known limitation

Neither diagnostic surface reports raw WebRTC statistics (RTT, jitter,
packet loss, bitrate) yet — see `docs/telemetry.md#connection-quality--webrtc-stats`.
