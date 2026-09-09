---
title: Permissions
description: What each RTC permission and chat scope grants, and why unset always means denied.
---

Permissions are decided when your backend mints a
[token](/authentication/tokens) and signed into it. Nothing a client sends
can widen them.

## RTC permissions

| Flag | Grants | Default |
|---|---|---|
| `join` | Entering the room at all | `false` |
| `subscribe` | Receiving other participants' tracks | `false` |
| `publish` | Sending any track | `false` |
| `publishAudio` | Narrows `publish` to the microphone | `false` |
| `publishVideo` | Narrows `publish` to the camera | `false` |
| `publishData` | Data-channel messages | `false` |

**Unset means denied.** Every flag resolves to an explicit boolean at mint
time, so there is no permissive default left to inherit and no "unset" state
for a verifier to interpret.

Two behaviours follow from that and are worth knowing:

- `publish: true` with neither `publishAudio` nor `publishVideo` means
  **both** are allowed. "Let them publish, I don't much care what" is the
  common case; the sub-flags exist to narrow it.
- A sub-flag **without** `publish` grants nothing. The sub-flags were never
  independently sufficient.

### Common shapes

```ts
// A participant in a call
{ join: true, subscribe: true, publish: true }

// Audio-only participant
{ join: true, subscribe: true, publish: true, publishAudio: true }

// A viewer — cannot publish, by construction
{ join: true, subscribe: true }

// A bot that only sends data
{ join: true, publishData: true }
```

### Where they are enforced

The signaling gateway re-verifies the signed permissions on every join and
on every publish. They are not advisory and they are not checked only once.

## Chat scopes

| Scope | Grants |
|---|---|
| `chat:read` | Reading messages and history |
| `chat:send` | Posting, editing and deleting your own |
| `chat:moderate` | Deleting anyone's message |
| `chat:manage` | Membership and conversation settings |

Chat authorization is **two independent checks**, and this trips people up:

1. What the token allows — its `scopes`.
2. What membership allows — the user's role in that conversation
   (`MEMBER`, `MODERATOR`, `ADMIN`).

A token can only ever **narrow** the role. Asking for `chat:moderate` as a
plain member grants nothing; the mint succeeds and the scope is simply not
present. That way a compromised token is never more powerful than the user
it was minted for.

```ts
await raven.chat.createToken({
  userId: 'alice',
  scopes: ['chat:read', 'chat:send'],   // narrower than her ADMIN role
});
```

## Live-stream roles

A stream's roles are permission shapes, not a separate system:

| Role | RTC permissions | Chat scopes |
|---|---|---|
| `HOST` / `CO_HOST` | join, subscribe, publish | read, send, moderate |
| `VIEWER` | join, subscribe | read, send |

Which one you get is decided entirely by which endpoint your backend called.

## Related

- [Access tokens](/authentication/tokens) · [Security](/authentication/security)
- [Roles & permissions](/production/roles-and-permissions) — *project* roles, a different axis.
