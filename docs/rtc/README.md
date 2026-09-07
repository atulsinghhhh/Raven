# Raven RTC

Raven's realtime communication infrastructure — Raven's own control
plane, signaling protocol and SFU, built on open WebRTC standards (ICE,
DTLS-SRTP, RTP/RTCP). No custom media protocol, and no third-party media
server.

## Start here

| Document | What it covers |
|---|---|
| [Architecture](./architecture.md) | How the whole thing fits together: the two planes, joining a call, negotiation, tracks, simulcast, reconnection, data channels, network quality. |
| [Signaling protocol](./signaling.md) | The client↔API wire contract, message by message. For writing a client or debugging one. |
| [SFU](./sfu.md) | The media plane: anatomy, RTP/RTCP recovery, configuration, draining, metrics, logs. |
| [Networking](./networking.md) | Ports, NAT, firewall rules, TURN, and how to diagnose a failed connection. |
| [Scaling](./scaling.md) | Allocation, health, regions, and **what has and has not been measured**. |
| [Security](./security.md) | Secrets, tokens, permissions, and what the media plane refuses to trust. |
| [Test matrix](./test-matrix.md) | What is tested, at what size, against which browsers — and **what has not been tested**. |

## Using the SDKs

The task-oriented guides — quickstart, rooms and participants, audio and
video, screen sharing, reconnection, permissions, diagnostics,
troubleshooting — are the published documentation site's content, under
[`apps/docs/content/rtc/`](../../apps/docs/content/rtc). The documents in
*this* directory are the architectural and operational reference: what the
system is, how to run it, and what it does not do yet.

Per-SDK references live alongside them: [web](../sdk/web.md),
[React Native](../sdk/react-native.md), [Flutter](../sdk/flutter.md),
[TypeScript server](../sdk/server/typescript.md),
[Python server](../sdk/server/python.md).

## Migrating

Raven previously ran on LiveKit. If you are upgrading an existing
deployment, read **[Migrating from Raven + LiveKit](../migration/from-livekit.md)** —
environment variables and mobile dependencies change, and five behaviours
shift in ways worth knowing.

The audit the migration was planned from, including the capability matrix
and its two open gaps, is in
[native-rtc-migration-map.md](../architecture/native-rtc-migration-map.md).

## Known gaps

Two capabilities are not implemented, and are recorded rather than
implied:

- **Congestion control** — TWCC feedback is collected but not consumed to
  drive simulcast layer selection, so a subscriber on a degrading
  connection sees loss rather than a lower layer.
- **Server-side quality verdict** — `getConnectionQuality()` returns
  `'unknown'`; per-track measured stats are available from
  `getConnectionStats()`.

Neither is exercised by any test, because testing under loss would
measure the absence of a feature rather than a regression. Nor has NAT
traversal been tested with a relay-only path — the largest untested
surface in the stack. Both are recorded in the
[test matrix](./test-matrix.md#5-network-conditions-and-nat-traversal-spec-41).

Raven also does not claim a supported participant count for this release.
See [scaling](./scaling.md#capacity-what-was-measured) for what was
actually measured and what was not.
