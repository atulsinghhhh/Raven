# Livqeno Chat — Reactions

```js
await chat.messages.addReaction('msg_3xR…', '👍');
await chat.messages.removeReaction('msg_3xR…', '👍');

chat.on('reactionAdded', (event) => {
  console.log(`${event.userId} reacted ${event.emoji}`);
});
```

## Idempotent in both directions

Adding the same reaction twice is a no-op, not a duplicate. Removing one that
isn't there succeeds. Both are guaranteed by a unique constraint on
`(messageId, userId, emoji)`, so a double-tap on a flaky connection is
harmless.

That matters more than it sounds: reactions are the most double-tapped control
in any chat UI, and they're often clicked on exactly the connection quality
where a request might be retried.

## Grouped, not raw

Messages carry reactions already grouped per emoji:

```json
"reactions": [
  { "emoji": "👍", "count": 3, "userIds": ["alice", "bob", "carol"] },
  { "emoji": "🎉", "count": 1, "userIds": ["dave"] }
]
```

Clients want "👍 ×3 (alice, bob, carol)", not three rows to group themselves.
Doing it server-side means every transport agrees on the shape.

`userIds` lets you render "you reacted" state and a hover tooltip without a
second request.

## Limits

Up to 200 reactions per message (`CHAT_MAX_REACTIONS_PER_MESSAGE`), and 32
characters per emoji — enough for any real emoji including multi-codepoint
sequences like 👨‍👩‍👧‍👦, and short enough that the field can't become a second
message body.

Livqeno doesn't validate that a reaction *is* an emoji. Products use custom
reactions, `:shipit:`-style shortcodes, and image keys, and an allow-list would
break all of them to prevent nothing.

Rate limited to 60 per 10 seconds per user.

## Deleted messages

You can't react to a deleted message — it returns `MESSAGE_DELETED`. Existing
reactions are dropped from the payload when a message is deleted, along with
the rest of its body.

## React

```jsx
import { useReactions, useChatClient } from '@ravenkash/react';

function Reactions({ message }) {
  const { add, remove, pending } = useReactions();
  const client = useChatClient();

  return message.reactions.map((reaction) => {
    const mine = reaction.userIds.includes(client?.userId);
    return (
      <button
        key={reaction.emoji}
        disabled={pending}
        title={reaction.userIds.join(', ')}
        onClick={() => (mine ? remove(message.id, reaction.emoji) : add(message.id, reaction.emoji))}
      >
        {reaction.emoji} {reaction.count}
      </button>
    );
  });
}
```
