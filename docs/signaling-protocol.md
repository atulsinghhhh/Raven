# Signaling protocol — moved

This was the wire reference for the **full-mesh** protocol: every SDP and
ICE message carried a `targetParticipantId`, and the server forwarded it
from one browser to another. Livqeno is an SFU now. A client has exactly one
peer, so a negotiation message needs no target, and several message names
survived the change while their meanings did not.

That last part is why this file is a pointer rather than a banner-topped
archive. A reader looking up `sdp.offer` in the old document would find a
message that still exists, still has that name, and means something else.

**Read [`docs/rtc/signaling.md`](./rtc/signaling.md)** — the current
contract, generated from and cross-checked against
`apps/api/src/modules/signaling/signaling.constants.ts`.

| What you came here for | Where it is now |
|---|---|
| Connecting, and how the token is passed | [rtc/signaling.md#connecting](./rtc/signaling.md#connecting) |
| Client → server messages | [rtc/signaling.md#client-server](./rtc/signaling.md#client-server) |
| Server → client messages | [rtc/signaling.md#server-client](./rtc/signaling.md#server-client) |
| Error codes, and which are retryable | [rtc/signaling.md#error](./rtc/signaling.md#error) |
| Close codes | [rtc/signaling.md#close-codes](./rtc/signaling.md#close-codes) |
| Versioning policy | [rtc/signaling.md#versioning](./rtc/signaling.md#versioning) |
| A complete join, on the wire | [rtc/signaling.md#a-complete-join-on-the-wire](./rtc/signaling.md#a-complete-join-on-the-wire) |
| Writing a client from scratch | [rtc/signaling.md#writing-a-client](./rtc/signaling.md#writing-a-client) |

The old and new shapes are compared directly in
[migration/from-livekit.md](./migration/from-livekit.md).
