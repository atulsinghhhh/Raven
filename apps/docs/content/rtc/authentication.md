---
title: RTC Authentication
description: How an RTC token is minted, what its permissions control, and why the client never sees your API key.
---

Every RTC join needs a token minted by your backend with your project's
API key. The client SDK never sees the key — only the short-lived token
your backend hands it.

<Tabs>
<Tab title="Node.js">

```ts
const token = await raven.tokens.create({
  room: 'demo-room',
  identity: req.user.id,        // from YOUR session, never from the client
  permissions: { join: true, publish: true, subscribe: true },
  expiresIn: 3600,               // optional, seconds
});
```

</Tab>
<Tab title="Python">

```python
token = raven.tokens.create(
    CreateTokenParams(
        room="demo-room",
        identity=request.user.id,  # from YOUR session, never from the client
        permissions=TokenPermissions(join=True, publish=True, subscribe=True),
        expires_in=3600,           # optional, seconds
    )
)
```

</Tab>
</Tabs>

The response — `{ token, endpoint, iceServers, expiresAt, ... }` — is
exactly what every client SDK's `join()`/`Raven(...)` constructor
expects; forward it unchanged.

## Permissions

| Permission | Grants |
|---|---|
| `join` | Enter the room at all. |
| `publish` | Publish camera/microphone/screen-share tracks. |
| `subscribe` | Receive other participants' published tracks. |
| `publishData` | Send data messages ([Rooms & Participants](/rtc/rooms-and-participants#sending-data)). |

A viewer-only participant gets `join`+`subscribe` with `publish: false` —
set server-side, at mint time. The SDK has no client-side way to request
more than the token grants; asking a room to publish without permission
fails with `PERMISSION_DENIED` rather than silently degrading.

## What the client decodes vs. what the server verifies

The SDK decodes the token client-side only to read `room`/`identity` for
early, friendlier errors (`ROOM_NOT_FOUND` before a confusing connection
failure) — it never treats that decoded content as authoritative.
Every permission is re-checked server-side on the actual media
connection, so a tampered or replayed token fails there regardless of
what it claims to contain.

## Expiry

Every token expires. `ttlSeconds` sets the lifetime, the default comes
from the deployment (10 minutes on a stock configuration) and the ceiling
is 6 hours — there is no way to request a token that never expires.

Expiry is the primary control on a leaked token, which is why the default
is short. Mint one per join rather than reusing one across sessions.

A connection attempt with an aged-out token fails with `TOKEN_EXPIRED`,
kept separate from `INVALID_TOKEN` precisely so your client can tell
"ask the backend for a fresh token" apart from "something is
misconfigured".

## Revocation

A token can also be killed before it expires:

```http
DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}
```

`tokenId` is the `id` field from the mint response. The call is scoped to
the project and environment of the API key you present, so you can only
revoke your own tokens; anything else answers `404`, the same as a token
that never existed. It is idempotent — revoking twice, or revoking a
token that has already expired, succeeds.

### What revocation does

It refuses the token for anything **new**. The next signaling connection
and the next telemetry call made with it fail with `TOKEN_REVOKED`, a
terminal error the SDK surfaces rather than retrying: reconnecting would
just re-present the same dead credential.

### What revocation does not do

**It does not hang up a call already in progress.** Authorization is
checked when a connection is established, not re-checked on every frame,
so a participant who joined a moment before you revoked their token stays
in the call until they leave or their client's next reconnect fails.

To end a session that is already running, close the room:

```http
DELETE /v1/rooms/{roomId}
```

That is the control that disconnects live participants. Revocation is for
stopping *future* joins — for example when you have handed out a token
and then decided that user should not use it.

Because of that boundary, a short `ttlSeconds` matters more than
revocation does for containing a leaked token. Revocation is a useful
second control, not a replacement for a short lifetime.

## Project and room isolation

Two properties are signed into every token and cannot be edited by
whoever holds it:

- **Project and environment.** A token is minted by one project's API key
  and is only ever valid for that project, in that environment. A
  development token cannot reach production data, and one tenant's token
  is meaningless against another's.
- **The room.** A token authorizes exactly one room, fixed at mint time.
  If your client also sends a room id when it joins, it has to match the
  one in the token — it cannot override it. So there is no way to take a
  token minted for `room-a` and use it to join `room-b`.

Permissions work the same way: they are signed, and the server enforces
what was signed rather than what the client asks for at join time. See
[Permissions](/rtc/permissions).

Browser origins are a separate, per-project control on top of all this —
see [Browser security & CORS](/authentication/browser-security).

See [Authentication → Tokens](/authentication/tokens) for the shared
token model across RTC and Chat.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `INVALID_TOKEN` | Token malformed, or minted for a different project/environment. | Confirm the token came straight from `tokens.create()`, unmodified. |
| `TOKEN_EXPIRED` | Past `expiresAt`. | Mint a new one — see [Expiry](#expiry) above. |
| `ROOM_NOT_FOUND` | The `roomId` passed to `join()` doesn't match the token's `room`. | Pass the exact same room id/name used in `tokens.create({ room })`. |
| `TOKEN_REVOKED` | Someone called `DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}` on this token. | Mint a new one. Retrying with the same token cannot succeed. |
| `ORIGIN_NOT_ALLOWED` | The page's origin is not on the project's allow-list. | Add it under **Project Settings → Security → Allowed Origins**. See [Browser security](/authentication/browser-security). |
| `USAGE_LIMIT_EXCEEDED` | The account has spent its included Livqeno minutes. | Nothing to retry — this one is a billing state, not a transient failure. Sessions already running are unaffected. |

## Production notes

- Mint a token per join, not one shared token reused across sessions —
  short lifetimes are the point.
- Set `identity` from your backend's own authenticated session. A
  client-supplied identity is a privilege-escalation bug waiting to
  happen, not a convenience.
- Don't request more permission than the participant needs — a viewer
  gets `publish: false`, always, regardless of what the client asks for.

## Related

- [Quickstart](/rtc/quickstart) — where this token is used end-to-end.
- [Rooms & Participants](/rtc/rooms-and-participants)
- [Authentication → Tokens](/authentication/tokens) — the model shared with Chat.

## API reference

`raven.tokens.create()` (Node.js) / `raven.tokens.create()` (Python) —
see [Node.js SDK](/sdk/node) and [Python SDK](/sdk/python) for the full
`Raven` server client each lives on.
