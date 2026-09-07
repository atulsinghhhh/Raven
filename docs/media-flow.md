# Media flow — moved

This document explained why media never passes through the API or the
signaling server, and traced a connection from `getUserMedia` to the
first forwarded RTP packet. **The principle is unchanged and still
load-bearing** — but the path it traced went through a third-party SFU,
and the mechanics no longer match.

**Read [`docs/rtc/architecture.md`](./rtc/architecture.md) instead.**

| What you came here for | Where it is now |
|---|---|
| Why media does not go through the API or signaling | [rtc/architecture.md#the-two-planes](./rtc/architecture.md#the-two-planes) |
| The full connection, annotated | [rtc/architecture.md#joining-a-call](./rtc/architecture.md#joining-a-call) |
| Where TURN fits | [rtc/networking.md#turn](./rtc/networking.md#turn) |
| How a candidate pair is actually chosen | [rtc/networking.md#how-a-connection-is-actually-made](./rtc/networking.md#how-a-connection-is-actually-made) |
| Diagnosing a connection that never establishes | [rtc/networking.md#diagnosing-a-failed-connection](./rtc/networking.md#diagnosing-a-failed-connection) |

The one sentence worth carrying forward verbatim: **the control plane
being down does not stop media that is already flowing.** SRTP goes
client ↔ SFU directly, so restarting the API costs its clients a
signaling reconnect, not a dropped call. That property is why the two
planes are separate, and it is tested — see
[rtc/test-matrix.md](./rtc/test-matrix.md).
