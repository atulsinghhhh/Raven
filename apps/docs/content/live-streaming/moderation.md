---
title: Moderation
description: Hosts and co-hosts moderate a stream's chat with the same delete-anyone's-message capability Chat's ADMIN/MODERATOR roles already have.
---

Live Streaming doesn't introduce its own moderation system. A host's
credentials carry `ADMIN` chat scope, a co-host's carry `MODERATOR` —
both minted automatically when they're added as a
[host](/live-streaming/hosts) — and moderation itself is exactly the
[Chat moderation](/chat/moderation) call:

```ts
await stream.chat.messages.delete('msg_3xR…');
```

A viewer's chat token always carries `MEMBER` scope, so this call fails
for them with the same `PERMISSION_DENIED`-shaped error it would on any
ordinary conversation — there's no viewer-specific carve-out to keep
track of.

## What this doesn't cover yet

There's no stream-level "mute" or "kick a viewer" primitive today — a
viewer's access is bounded entirely by their token's expiry, not by a
revocable membership the way chat conversation membership is. Removing
a *host's* publish ability is
[removing them as a host](/live-streaming/hosts), which is a distinct
operation from chat moderation.

## Next

- [Hosts & Co-hosts](/live-streaming/hosts)
- [Chat → Moderation](/chat/moderation)
