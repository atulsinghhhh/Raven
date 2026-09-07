# NAT traversal — moved

This document covered why TURN is necessary, the connection types Raven
distinguishes, how to force a relay-only path, and an honest matrix of
which network conditions had actually been exercised. All of that still
matters; most of it has moved, and the parts that described reaching into
a third-party client's internals to observe candidate types are gone
rather than relocated.

**Read [`docs/rtc/networking.md`](./rtc/networking.md) instead.**

| What you came here for | Where it is now |
|---|---|
| Why NAT traversal is needed at all | [rtc/networking.md#how-a-connection-is-actually-made](./rtc/networking.md#how-a-connection-is-actually-made) |
| Host / srflx / relay, in Raven's terms | [rtc/networking.md#how-a-connection-is-actually-made](./rtc/networking.md#how-a-connection-is-actually-made) |
| Forcing a relay-only path, and verifying it relayed | [rtc/networking.md#forcing-a-relay-only-path](./rtc/networking.md#forcing-a-relay-only-path) |
| Ports and firewall rules | [rtc/networking.md#ports](./rtc/networking.md#ports) |
| Diagnosing a failed connection | [rtc/networking.md#diagnosing-a-failed-connection](./rtc/networking.md#diagnosing-a-failed-connection) |
| IPv6 | [rtc/networking.md#ipv6](./rtc/networking.md#ipv6) |
| What has and has not been tested | [rtc/test-matrix.md](./rtc/test-matrix.md#5-network-conditions-and-nat-traversal-spec-41) |
| coturn configuration | [turn.md](./turn.md) |

The old connectivity matrix has been folded into
[the test matrix](./rtc/test-matrix.md), which is now the single place
this repo states what was verified and what was not. Its headline has not
changed: **relay-only has never carried media in a test**, and that is
the largest untested surface in the stack.
