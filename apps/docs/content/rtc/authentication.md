---
title: RTC Authentication
description: How an RTC token is minted, what its permissions control, and why the client never sees your API key.
---

Every RTC join needs a token minted by your backend with your project's
API key. The client SDK never sees the key — only the short-lived token
your backend hands it.

```ts
const token = await raven.tokens.create({
  room: 'demo-room',
  identity: req.user.id,        // from YOUR session, never from the client
  permissions: { join: true, publish: true, subscribe: true },
  expiresIn: 3600,               // optional, seconds
});
```

## Permissions

| Permission | Grants |
|---|---|
| `join` | Enter the room at all. |
| `publish` | Publish camera/microphone/screen-share tracks. |
| `subscribe` | Receive other participants' published tracks. |
| `publishData` | Send data messages ([Rooms & Participants](/rtc/rooms-and-participants#data)). |

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

## Next

- [Quickstart](/rtc/quickstart)
- [Rooms & Participants](/rtc/rooms-and-participants)
