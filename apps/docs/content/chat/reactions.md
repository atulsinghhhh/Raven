---
title: Reactions
description: Idempotent, pre-grouped, and deliberately unvalidated.
---

<Tabs>
<Tab title="Web">

```ts
await chat.messages.addReaction('msg_3xR…', '👍');
await chat.messages.removeReaction('msg_3xR…', '👍');

chat.on('reactionAdded', (event) => {
  console.log(`${event.userId} reacted ${event.emoji}`);
});
```

</Tab>
<Tab title="React">

```tsx
const { add, remove, pending } = useReactions();
await add('msg_3xR…', '👍');
```

`pending` is true while a reaction call is in flight — disable the
button on it rather than letting a double-tap fire twice.

</Tab>
<Tab title="React Native">

```ts
await raven.chat!.messages.addReaction('msg_3xR…', '👍');
await raven.chat!.messages.removeReaction('msg_3xR…', '👍');
```

</Tab>
<Tab title="Flutter">

```dart
await chat.addReaction(messageId, '👍');
await chat.removeReaction(messageId, '👍');

chat.reactions.listen((event) {
  print('${event.userId} reacted ${event.emoji}');
});
```

</Tab>
</Tabs>

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

## Common errors

| Error | Why | Fix |
|---|---|---|
| Reaction silently doesn't appear twice | Idempotent by design — the second `addReaction` for the same `(message, user, emoji)` is a no-op, not an error. | Expected — read it as success, not a bug. |
| `INVALID_MESSAGE`/validation error on an over-length emoji field | Over the 32-character limit. | Cap custom shortcode length client-side before sending. |

## Production notes

- Render from the message's own `reactions` array, not a locally
  accumulated count — a reconnect replaying `reactionAdded` events you
  already counted would double them.
- Disable a reaction button while its own call is pending (React:
  `useReactions()`'s `pending`) rather than relying on idempotency alone
  to absorb a rapid double-tap.

## Related

- [Messages](/chat/messages) — reactions live on the message object itself.
- [Live Streaming → Reactions](/live-streaming/reactions) — the same
  mechanism, aggregated onto one root message per stream.
