---
title: Diagnostics
description: Real WebRTC stats — RTT, jitter, packet loss, bitrate, and codec — not a status dot.
---

Raven exposes two levels of diagnostic information, deliberately kept
separate because they cost different amounts to collect. Both are
`Room` methods, so they work identically on **Web and React Native** —
the same class, not a per-platform reimplementation. **Not currently
available on Flutter** — `RavenRoom` doesn't expose a stats method yet;
see [Common errors](#common-errors) below rather than working around it.

## `getDiagnostics()` — cheap, synchronous, always safe

```ts
const info = room.getDiagnostics();
// {
//   connectionState, reconnectCount, sdkVersion, platform, browser,
//   iceConnectionState, signalingState, // currently always undefined — see below
// }
```

Safe to call anywhere, any time — attach it to a bug report as-is. It
never contains a token or a secret.

`iceConnectionState`/`signalingState` are honestly `undefined` today:
the underlying media client doesn't expose either publicly, and Raven
doesn't reach into its unsupported internals to fake them — that
surface could change on any minor version bump. If a future release
exposes them, this will start reporting real values without a breaking
change.

## `getConnectionStats()` — real media-quality numbers

```ts
const stats = await room.getConnectionStats();
// {
//   connectionState,
//   connectionQuality,      // 'excellent' | 'good' | 'poor' | 'lost' | 'unknown' — the SFU's own read
//   local: TrackStats[],    // one entry per track you've published
//   remote: TrackStats[],   // one entry per track you've subscribed to
// }
```

Each `TrackStats` entry:

```ts
{
  kind, direction,          // 'send' | 'receive'
  bitrateBps,                // undefined on a track's very first sample — there's nothing yet to diff against
  packetsLost, packetLossPercent,
  jitterMs,
  roundTripTimeMs,           // only ever present on a send-direction track — WebRTC never reports a receiver's own RTT
  codec,                     // only ever present on a receive-direction video track
  frameWidth, frameHeight, framesPerSecond,
}
```

This is async and does real work — collecting it needs a round trip
through the platform's stats API per track. Call it periodically (every
few seconds is plenty), not on a tight loop.

```ts
setInterval(async () => {
  const stats = await room.getConnectionStats();
  console.log('quality:', stats.connectionQuality);
  for (const track of stats.remote) {
    if (track.packetLossPercent && track.packetLossPercent > 5) {
      console.warn(`${track.kind} losing packets: ${track.packetLossPercent.toFixed(1)}%`);
    }
  }
}, 5000);
```

On React Native, the same call works unchanged — `room` is the same
`Room` instance `raven.join()` returned:

```ts
const stats = await room.getConnectionStats();
```

## Server-side visibility

If your SDK version reports stats via telemetry, the same numbers land
in Raven's `Connection` records automatically — visible via
`raven connections inspect <id>` or the dashboard, with no extra code on
your end. Multiple tracks collapse into one connection-level figure per
field: RTT from a send-direction track, the worst jitter and packet loss
across every track, bitrate summed across all of them. This works
regardless of which client SDK reported it, including Flutter.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `getConnectionStats` is not a function (Flutter) | Not implemented on `RavenRoom` in this phase. | Read connection state via `room.connectionStateChanges` instead, or rely on server-side telemetry (above) for quality numbers on Flutter builds. |
| Every `TrackStats.bitrateBps` is `undefined` | First sample after a track just started — there's nothing to diff against yet. | Wait for the second poll interval before trusting bitrate. |

## Production notes

- Poll on an interval (5s is a reasonable default), never inside a
  render loop or a tight `while`.
- Treat `connectionQuality` as the SFU's summary judgment — use the raw
  `TrackStats` fields only when you need to explain *why* it's poor.
- Diagnostics never contain a token, a secret, or PII — safe to log or
  attach to a support ticket as-is.

## Related

- [Reconnection](/rtc/reconnection) — using `connectionQuality` to drive
  a UI indicator.
- [Troubleshooting](/rtc/troubleshooting) — reading these numbers when
  something's actually wrong.
