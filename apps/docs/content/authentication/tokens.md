---
title: Tokens
description: Minting RTC and chat tokens — permissions, TTLs, and what actually gets checked.
---

Tokens are the only credential that ever reaches a client — see
[Authentication](/getting-started/authentication) for the full model.
This page covers minting them from your backend.

## RTC tokens

```http
POST /v1/rooms/{roomId}/rtc-tokens
```

```ts
const token = await raven.tokens.create({
  room: roomId,
  identity: 'user-42',
  permissions: { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true },
  expiresIn: 3600, // seconds, capped at 6 hours
});
// { token, endpoint, iceServers, expiresAt, ... }
```

Raven's own permission vocabulary — `join`, `subscribe`, `publish`,
`publishAudio`, `publishVideo`, `publishData` — is translated internally
into the underlying SFU's grant shape. That indirection means the public
API contract doesn't change if the SFU underneath ever does.

`iceServers` in the response is STUN and short-lived TURN credentials
scoped to this participant and this token's TTL — always forward it
as-is to the client; never hand-construct one yourself.

Every mint also creates a `Participant` and `RtcToken` row as an audit
trail — that's the control-plane record, not the credential itself. The
actual bearer credential (a signed JWT) is generated fresh every call
and never persisted, since tokens are meant to be short-lived and simply
re-minted.

## Chat tokens

```http
POST /v1/chat/tokens
```

```ts
const token = await raven.chat.createToken({
  userId: 'alice',
  conversations: [conversation.publicId], // optional — omit for "any conversation this user belongs to"
  scopes: ['chat:read', 'chat:send'],      // optional — can only narrow the role's default, never widen it
  expiresIn: 3600,
});
```

Scopes are derived from the user's role in each conversation
(`MEMBER`/`MODERATOR`/`ADMIN`) and narrowed by whatever you pass — asking
for `chat:moderate` as a plain member grants nothing. See
[Chat Overview](/chat/overview#authorization--two-independent-checks).

## Environment follows the key

Both token types carry the environment of the API key that minted them,
as a claim inside the token — never as something the request can
specify. A development key cannot mint a token that reaches production
data, however it's asked. See [Environments](/production/environments).

## Revocation

An API key can be revoked (`raven keys revoke <id>`) independently of
any token it already minted — those expire on their own, on schedule.
There's no way to revoke a single already-issued token early; the
short lifetime is the control, not a revocation list.
