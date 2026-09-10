---
title: Token
description: A client's credential. Short-lived, scoped to one room or conversation, minted server-side.
---

A token is the only Raven credential that ever reaches a client. It is a
signed JWT your backend mints and forwards.

## Why it exists

An [API key](/concepts/api-key) grants everything in a project. A client
needs far less than that and cannot be trusted to hold it. A token is the
narrow version: one identity, one room or a named set of conversations, an
explicit permission set, and an expiry.

Crucially, **a client cannot request its own token**. Identity and
permissions come from your backend's authenticated session, never from a
value the client sent.

## The two kinds

| | RTC token | Chat token |
|---|---|---|
| Grants | join / publish / subscribe on one room | read / send / moderate / manage on named conversations |
| Default lifetime | 600s | 3600s |
| Maximum | 21600s (6h) | 21600s (6h) |
| Presented to | The signaling socket, and telemetry | The chat socket, and the chat REST API |
| Minted by | `raven.tokens.create()` | `raven.chat.createToken()` |

Neither works on the other plane. Each is signed with its own secret and
carries a fixed `aud`, so one can never be replayed as the other.

## What is signed

An RTC token carries the token id, the participant identity, the project,
the environment, the room id *and* name, the resolved permissions, and an
expiry. All of it is signed, so a connect costs no database round trip — and
none of it can be modified by the holder.

The claims are readable by whoever holds the token. That is fine: nothing in
them is secret. What matters is that they cannot be *changed*.

## Expiry is the control

The short lifetime is the primary security control, which is why there is
no way to request a non-expiring token. Mint on demand, one per
participant per join.

An RTC token can also be revoked before it expires, via
`DELETE /v1/rooms/{roomId}/rtc-tokens/{tokenId}`. That stops the token
opening anything new; it does not disconnect a session already
established on it, so it complements a short lifetime rather than
replacing it. See
[RTC authentication → Revocation](/rtc/authentication#revocation).

Chat tokens carry the same revocation check at connect time, but no
public endpoint triggers a chat revocation yet — see
[Known limitations](/reference/known-limitations).

## Minimal example

```ts
const credentials = await raven.tokens.create({
  room: room.id,
  identity: 'user-42',
  permissions: { join: true, subscribe: true },
});
```

That token can join and watch. It cannot publish, and no request the client
makes will change that.

## Related

- [Access tokens](/authentication/tokens) — the full minting API.
- [Permissions](/authentication/permissions) — what each flag grants.
- [Generate a token](/get-started/first-token).
