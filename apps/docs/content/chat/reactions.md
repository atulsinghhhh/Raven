---
title: Reactions
description: Idempotent, pre-grouped, and deliberately unvalidated.
---

```ts
await chat.messages.addReaction('msg_3xR…', '👍');
await chat.messages.removeReaction('msg_3xR…', '👍');

chat.on('reactionAdded', (event) => {
  console.log(`${event.userId} reacted ${event.emoji}`);
});
```

## Idempotent in both directions

Adding the same reaction twice is a no-op, not a duplicate. Removing one
that isn't there succeeds. Both are guaranteed by a unique constraint on
`(messageId, userId, emoji)`, so a double-tap on a flaky connection is
harmless — and reactions are the most double-tapped control in any chat
UI, often clicked on exactly the connection quality where a request
might get retried.

## Grouped, not raw

Messages carry reactions already grouped per emoji:

```json
"reactions": [
  { "emoji": "👍", "count": 3, "userIds": ["alice", "bob", "carol"] },
  { "emoji": "🎉", "count": 1, "userIds": ["dave"] }
]
```

Clients want "👍 ×3 (alice, bob, carol)", not three rows to group
themselves — doing it server-side means every transport agrees on the
shape. `userIds` lets you render "you reacted" state and a hover tooltip
without a second request.

## Limits

Up to 200 reactions per message, and 32 characters per emoji — enough
for any real emoji, including multi-codepoint sequences like
👨‍👩‍👧‍👦, and short enough that the field can't become a second message
body.

Raven doesn't validate that a reaction *is* an emoji. Products use
custom reactions, `:shipit:`-style shortcodes, and image keys — an
allow-list would break all of them to prevent nothing.
