---
title: Tokens
description: Minting RTC and chat tokens — permissions, TTLs, and what actually gets checked.
---

Tokens are the only credential that ever reaches a client — see
[Authentication](/authentication) for the full model.
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

Livqeno's own permission vocabulary — `join`, `subscribe`, `publish`,
`publishAudio`, `publishVideo`, `publishData` — is what gets signed into
the token and what the signaling gateway enforces. There is no translation
into a third party's grant shape anywhere in the path: the public API, the
signed claim, the authorization checks and the media server all speak these
same six names.

Keeping the public names independent of whatever the media plane wants
internally is exactly what let Livqeno replace its own SFU without breaking
this contract.

Every flag is **denied unless granted** — see
[Permissions](/authentication/permissions) for the two consequences of that
which are worth knowing.

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
[Chat Overview](/chat#authorization--two-independent-checks).

## Environment follows the key

Both token types carry the environment of the API key that minted them,
as a claim inside the token — never as something the request can
specify. A development key cannot mint a token that reaches production
data, however it's asked. See [Environments](/production/environments).

## Revocation

An API key can be revoked (`raven keys revoke <id>`) independently of
any token it already minted.

A single RTC token can be revoked early too:
`DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}`, using the `id` from the
mint response. It is scoped to the API key's own project and environment,
and it is idempotent.

Revocation refuses the token for *new* connections, which then fail with
`TOKEN_REVOKED`. It does not disconnect a session already running on that
token — close the room (`DELETE /v1/rooms/{roomId}`) for that. So the
short lifetime remains the primary control and revocation is the second
one. Details in
[RTC authentication → Revocation](/rtc/authentication#revocation).
