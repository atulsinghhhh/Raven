---
title: Moderation
description: Deleting someone else's message is the same call as deleting your own — the server decides whether your role allows it.
---

Raven Chat doesn't have a separate moderation API. A moderator deletes a
message the same way anyone deletes their own — the difference is
entirely in what the server allows, not in which endpoint gets called.
The same call, on every SDK:

<Tabs>
<Tab title="Web">

```ts
await chat.messages.delete('msg_3xR…');
```

</Tab>
<Tab title="React Native">

```ts
await raven.chat!.messages.delete('msg_3xR…');
```

</Tab>
<Tab title="Flutter">

```dart
await chat.delete(messageId);
```

</Tab>
</Tabs>

- A `MEMBER` can only delete their own messages.
- A `MODERATOR` or `ADMIN` can delete anyone's message in that
  conversation — granted by the `chat:moderate` scope (see
  [Authentication](/chat/authentication#two-independent-checks)).

Deleting is soft: the row survives with `deletedAt` set, so a
moderated message can still be audited later. There is currently no
"mute" or "ban" primitive — removing someone's ability to send is
[removing their membership](/chat/members#remove-a-member), which is
soft too and can be reversed by re-adding them.

## Assigning the moderator role

Roles are set when a member is added, or changed by re-adding them with
a new role:

```ts
await raven.chat.addMember('support-room-42', { userId: 'carol', role: 'MODERATOR' });
```

This is a server-side-only call — no client SDK can grant itself or
anyone else a role. See [Members](/chat/members) for the full role
table and how removal works.

## Live Streaming

A live stream's host and co-hosts are automatically given `ADMIN`/
`MODERATOR` scope on the stream's attached conversation — see
[Live Streaming → Moderation](/live-streaming/moderation).

## Next

- [Members](/chat/members)
- [Messages](/chat/messages)
