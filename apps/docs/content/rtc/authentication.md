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

## Expiry and revocation

Tokens are short-lived by default and cannot be revoked individually —
they simply expire. There's currently no way to invalidate one before
that. See [Authentication → Tokens](/authentication/tokens) for the
shared token model across RTC and Chat.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `INVALID_TOKEN` | Token malformed, or minted for a different project/environment. | Confirm the token came straight from `tokens.create()`, unmodified. |
| `TOKEN_EXPIRED` | Past `expiresAt`. | Mint a new one — see [Expiry and revocation](#expiry-and-revocation) above. |
| `ROOM_NOT_FOUND` | The `roomId` passed to `join()` doesn't match the token's `room`. | Pass the exact same room id/name used in `tokens.create({ room })`. |

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
