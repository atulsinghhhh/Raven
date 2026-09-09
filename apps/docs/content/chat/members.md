---
title: Members
description: Adding, removing, and listing who's in a conversation — server-side, since membership is what authorization is checked against.
---

Membership is what a token's scopes get checked against — see
[Chat → Authorization](/chat#authorization--two-independent-checks).
Managing it is a server-side operation only: `@ravenkash/chat` (the browser
SDK) has no member-management calls, by design — a client can join and
send messages, never grant itself access to a conversation it isn't
already in.

## Roles

| Role | Grants |
|---|---|
| `MEMBER` | Read and send — the default. |
| `MODERATOR` | Everything `MEMBER` can, plus deleting anyone's message. |
| `ADMIN` | Everything `MODERATOR` can, plus reconfiguring the conversation. |

The role determines the scopes described in
[Chat → Authorization](/chat#authorization--two-independent-checks)
— a token can narrow what a role allows but never widen it.

## Add a member

```ts
import { Raven } from '@ravenkash/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const member = await raven.chat.addMember('support-room-42', { userId: 'carol', role: 'MODERATOR' });
// { userId: 'carol', role: 'MODERATOR', status: 'ACTIVE', joinedAt: '...', leftAt: null }
```

```python
from raven import Raven, ChatMemberRole

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])
member = raven.chat.add_member("support-room-42", "carol", role=ChatMemberRole.MODERATOR)
```

`role` defaults to `MEMBER` when omitted. Adding someone who already
left reactivates their existing membership — their message history
stays attributed to the same row rather than starting a new one.

## List members

```ts
const members = await raven.chat.listMembers('support-room-42');
```

```python
members = raven.chat.list_members("support-room-42")
```

## Remove a member

```ts
await raven.chat.removeMember('support-room-42', 'carol');
```

```python
raven.chat.remove_member("support-room-42", "carol")
```

Removal is soft — `status` moves to `LEFT` and `leftAt` is set. Their
past messages keep a resolvable author; they just can no longer send or
read in this conversation until re-added.

## What this means for each SDK

Membership calls exist on `@ravenkash/server` and `raven-sdk` (Python) only.
`@ravenkash/chat`, `@ravenkash/react`, `@ravenkash/react-native`, and `raven_chat`
(Flutter) can read who's *currently present* via
[Presence](/chat/presence), but none of them can add, remove, or list
members — that's a backend operation, the same way creating a
conversation is. The CLI doesn't currently have a `raven chat members`
command; use the SDK or [REST API](/api) directly.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `404` on `addMember` | The conversation reference doesn't resolve. | Check the id/name/roomId — same three forms as [Conversation references](/chat#conversation-references). |
| A removed member's messages disappear | They shouldn't — removal is soft. | Confirm you're calling `removeMember`, not `deleteMessage` on their history; see [Moderation](/chat/moderation). |

## Production notes

- Reflect role changes in your own app's UI promptly — a demoted
  moderator's existing chat token isn't revoked, but their *next* action
  requiring the old scope will be rejected server-side.
- There's no bulk-add call yet — seed initial membership at creation
  time via `createConversation({ members })` where you can, rather than
  looping `addMember` calls afterward.

## Related

- [Conversations](/chat/conversations)
- [Chat → Authorization](/chat#authorization--two-independent-checks)
