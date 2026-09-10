---
"@ravenkash/rtc": patch
---

Media now negotiates for the first participant in a room.

The SFU took the DTLS client role when answering and the server role when
offering, on the same peer connection. Since it offers at join and answers
when a client publishes, the first participant in any room hit both in that
order: it answered the join offer `active`, then the SFU's answer to its
publish also said `active`. That asks both peers to swap DTLS roles
mid-session, which is not a thing a transport can do — Chrome rejected the
answer with "Failed to set SSL role for the transport", the publish never
negotiated, and the participant sent and received nothing while the SDK
cheerfully logged "camera published".

Later joiners were unaffected: they answer an SFU offer first and happen to
line up, which is why this looked intermittent rather than deterministic.

`services/sfu` now pins its answering DTLS role to server
(`SetAnsweringDTLSRole`), so the client is the DTLS client and the SFU the
DTLS server whichever side offered. `docs/rtc/signaling.md` documents that
as part of the protocol.

The versioned part is `@ravenkash/rtc`, which no longer discards the
browser's reason when it cannot answer an offer. It reported a bare "Could
not answer the server's offer", which said that renegotiation broke but not
why — and renegotiation is exactly where a role or m-line mismatch shows
up. The underlying message is now included.

`services/sfu` is not a published package, so the fix itself is not
versioned here.
