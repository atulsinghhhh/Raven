---
title: Reactions
description: A lightweight, aggregated realtime event — riding the same Reaction model Chat already has, not a second primitive.
---

<Tabs>
<Tab title="Web">

```ts
await stream.react('❤️');

stream.chat.on('reactionAdded', (event) => {
  console.log(event.userId, event.emoji);
});
```

</Tab>
<Tab title="React">

```tsx
import { useLiveStream } from '@corvidhq/react';

const { react } = useLiveStream();
<button onClick={() => react('❤️')}>❤️</button>
```

Available from `useLiveStream()` on both host and viewer — there's no
separate reaction hook.

</Tab>
<Tab title="React Native">

```ts
await stream.react('❤️');
```

</Tab>
<Tab title="Flutter">

```dart
await stream.react('❤️');
```

</Tab>
</Tabs>

There's no separate "stream reaction" system. `stream.react()` adds a
[Chat reaction](/chat/reactions) to the stream's hidden system root
message (`chatRootMessageId`) — the same idempotent,
grouped-per-emoji model documented there. A double-tapped reaction is a
no-op, not a duplicate, for the same reason a double-tapped reaction on
an ordinary message is.

## Requirements

`stream.react()` throws if the stream was joined without chat
credentials, or if it has chat but no `chatRootMessageId` — both are
programmer-error conditions (missing/incomplete join credentials), not
things a normal integration should hit once
[`LiveStream.join()`](/live-streaming/live-chat) is wired up correctly
with the credentials the create/token endpoints return.

## Reading current reaction counts

Reactions aggregate exactly like they do on any message — see
[Chat → Reactions](/chat/reactions#grouped-not-raw) for the grouped
shape (`{ emoji, count, userIds }`).

## Next

- [Live Chat](/live-streaming/live-chat)
- [Analytics](/live-streaming/analytics)
