---
title: Members
description: Adding, removing, and listing who's in a conversation — server-side, since membership is what authorization is checked against.
---

Membership is what a token's scopes get checked against — see
[Chat → Authorization](/chat#authorization--two-independent-checks).
Managing it is a server-side operation only: `@raven/chat` (the browser
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
import { Raven } from '@raven/server';
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

Membership calls exist on `@raven/server` and `raven-sdk` (Python) only.
`@raven/chat`, `@raven/react`, `@raven/react-native`, and `raven_chat`
(Flutter) can read who's *currently present* via
[Presence](/chat/presence), but none of them can add, remove, or list
members — that's a backend operation, the same way creating a
conversation is. The CLI doesn't currently have a `raven chat members`
command; use the SDK or [REST API](/api-reference) directly.

## Next

- [Conversations](/chat/conversations)
- [Chat → Authorization](/chat#authorization--two-independent-checks)
