---
title: Chat Authentication
description: Two independent checks — what the token allows, and what membership allows — and why a token can only narrow, never widen, a role.
---

A chat token and an RTC token are minted separately, signed with
different keys, and neither works on the other plane — a leak on one
never compromises the other.

```ts
const token = await raven.chat.createToken({
  userId: 'alice',
  conversations: [conversation.publicId],
  expiresIn: 3600, // optional, seconds
});
```

## Two independent checks

**The token** says who you are and what you may do in general: a
project, a user identity, an expiry, an optional list of conversations,
and a set of scopes.

**Membership** says which conversations you actually belong to, and at
what role. A role (`MEMBER`, `MODERATOR`, `ADMIN`) per conversation
determines which scopes are available — a token can narrow what a role
allows but never widen it, so handing out an intentionally limited token
is always safe.

| Scope | Grants |
|---|---|
| `chat:read` | read messages, history, presence, read receipts |
| `chat:send` | send/edit/delete your own messages, react, type |
| `chat:moderate` | delete anyone's message |
| `chat:manage` | reconfigure the conversation |

## What the server never trusts from a browser

The sender identity always comes from the signed token, never a field
in the request body — and `system`/`event` message types require a
project API key, so a connected user can't fabricate an
official-looking announcement. See [Moderation](/chat/moderation) for
how the `chat:moderate` scope is actually enforced.

## Next

- [Quickstart](/chat/quickstart)
- [Members](/chat/members) — how roles get assigned
- [Authentication → Tokens](/authentication/tokens) — the shared token
  shape across RTC and Chat
