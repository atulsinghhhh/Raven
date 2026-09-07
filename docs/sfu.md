# SFU — moved

This document described the LiveKit-era media plane: how Raven integrated
a third-party SFU, configured it, and authenticated to it. **None of that
is how Raven works now**, and none of it was worth keeping behind a
warning banner — a reader who arrives here from an old link or a search
result should not have to judge which paragraphs still apply.

**Read [`docs/rtc/sfu.md`](./rtc/sfu.md) instead.** It covers the media
plane as it actually is: Raven's own SFU, in Go on Pion.

| What you came here for | Where it is now |
|---|---|
| What the SFU is, and what it deliberately is not | [rtc/sfu.md#what-it-is-and-is-not](./rtc/sfu.md#what-it-is-and-is-not) |
| Anatomy — rooms, participants, tracks, downtracks | [rtc/sfu.md#anatomy](./rtc/sfu.md#anatomy) |
| Codecs, and where simulcast needs to read the payload | [rtc/sfu.md#codecs](./rtc/sfu.md#codecs) |
| NACK, PLI, FIR, TWCC | [rtc/sfu.md#recovery-rtprtcp](./rtc/sfu.md#recovery-rtprtcp) |
| Running a node: config, ports, draining | [rtc/sfu.md#operating-a-node](./rtc/sfu.md#operating-a-node) |
| Metrics and logs | [rtc/sfu.md#metrics](./rtc/sfu.md#metrics) |
| Known gaps | [rtc/sfu.md#known-gaps](./rtc/sfu.md#known-gaps) |
| TURN, and the ephemeral credential scheme | [rtc/networking.md#turn](./rtc/networking.md#turn) |
| Room lifecycle, publishing, subscribing, simulcast | [rtc/architecture.md](./rtc/architecture.md) |
| Token authentication | [rtc/security.md#rtc-tokens](./rtc/security.md#rtc-tokens) |
| What the SFU choice was, and why it was reversed | [architecture/sfu-comparison.md](./architecture/sfu-comparison.md) |

Upgrading a deployment that ran on LiveKit:
[migration/from-livekit.md](./migration/from-livekit.md).
