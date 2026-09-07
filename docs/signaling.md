# Signaling — moved

This document described the signaling layer as it was when a third-party
SFU owned negotiation and Raven's own WebSocket relayed SDP and ICE
between browsers in a full mesh. **That protocol no longer exists.** A
client has exactly one peer now — the SFU node serving its room — so the
server is a party to the negotiation rather than a courier, and every
message that named a `targetParticipantId` is gone.

Keeping 320 lines of that behind a warning banner would have been a trap:
several message *names* survived the change and their meanings did not,
so a reader skimming for the shape of `sdp.offer` would find a plausible,
wrong answer.

**Read these instead:**

| What you came here for | Where it is now |
|---|---|
| The wire protocol, message by message | [rtc/signaling.md](./rtc/signaling.md) |
| Close codes (4001/4002/4029) and versioning | [rtc/signaling.md#close-codes](./rtc/signaling.md#close-codes) |
| How joining actually works, end to end | [rtc/architecture.md#joining-a-call](./rtc/architecture.md#joining-a-call) |
| Why the SFU offers first, and how glare is resolved | [rtc/architecture.md#negotiation-the-sfu-offers](./rtc/architecture.md#negotiation-the-sfu-offers) |
| A room split across API instances: Redis, pub/sub, TTLs | [rtc/scaling.md#a-room-split-across-api-instances](./rtc/scaling.md#a-room-split-across-api-instances) |
| Heartbeats — the gateway sweep, `ping`/`pong`, node heartbeats | [rtc/scaling.md#heartbeats-at-two-levels](./rtc/scaling.md#heartbeats-at-two-levels) |
| Authentication, rate limits, what is never trusted | [rtc/security.md](./rtc/security.md) |
| Reconnection | [rtc/architecture.md#reconnection](./rtc/architecture.md#reconnection) |

The mesh-to-SFU protocol change is described, with a before/after, in
[migration/from-livekit.md](./migration/from-livekit.md). The decision
record for the original split — control plane owns authorization, media
server owns negotiation — is
[architecture/signaling.md](./architecture/signaling.md), kept as history.
