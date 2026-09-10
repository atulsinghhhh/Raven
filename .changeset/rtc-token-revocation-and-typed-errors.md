---
"@ravenkash/rtc": minor
---

RTC tokens can now be revoked, and two server errors reach you as their own
typed codes instead of a generic one.

`DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}` revokes a minted token
before it expires. Be clear about the boundary, because it is deliberate:
revocation refuses the token for anything *new* — the next signaling connect
and the next telemetry call fail with `TOKEN_REVOKED` — and does **not** hang
up a session already running on it. Authorization is checked when a
connection is established, not re-checked per frame, so a participant who
joined a moment earlier stays until they leave or their next reconnect fails.
Close the room (`DELETE /v1/rooms/{roomId}`) to cut a live session. A short
`ttlSeconds` therefore still does more to contain a leaked token than
revocation does; revocation is the second control, not a replacement.

Revocation is keyed by the token's `jti` — which is the `rtc_tokens` row id
already returned as `id` from the mint — and the tombstone expires with the
token, so nothing accumulates and no bearer token is ever stored. Same design
as chat's, rather than a second mechanism.

On the SDK side, `RTCErrorCode` gains `TOKEN_REVOKED` and
`USAGE_LIMIT_EXCEEDED`. The second is the one worth noticing: running out of
included Livqeno minutes previously surfaced as `SIGNALING_ERROR`, which is
indistinguishable from signaling actually breaking. It is the one join
failure whose remedy is commercial rather than technical, so an application
can now show a billing prompt instead of a retry button. Both are treated as
terminal for reconnect purposes: neither a backoff nor a fresh token can fix
a revoked credential or an exhausted allowance.
