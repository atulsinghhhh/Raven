---
title: Typing Indicators
description: Never persisted — a signal meaningless seconds after it happens.
---

<Tabs>
<Tab title="Web">

```ts
await chat.startTyping();
await chat.stopTyping();

chat.on('typing', (event) => {
  console.log(`${event.userId} ${event.isTyping ? 'started' : 'stopped'} typing`);
});
```

</Tab>
<Tab title="React">

```tsx
const { typingUsers, onInput } = useTyping();
// <input onChange={onInput} /> — call on every keystroke
```

`onInput()` already throttles itself to one signal per second and stops
automatically after a pause — there's no `startTyping()`/`stopTyping()`
to call yourself.

</Tab>
<Tab title="React Native">

```ts
await raven.chat!.startTyping();
await raven.chat!.stopTyping();
```

</Tab>
<Tab title="Flutter">

```dart
await chat.startTyping();
await chat.stopTyping();

chat.typing.listen((event) {
  print('${event.userId} ${event.isTyping ? "started" : "stopped"} typing');
});
```

</Tab>
</Tabs>

Safe to call `startTyping()` on every keystroke.

## Never persisted

Typing events never reach Postgres — a signal meaningless seven seconds
after it happens, and writing one per keystroke would be the single most
wasteful thing in the system. Redis, 7-second TTL, fan-out over pub/sub.
That's the whole implementation.

## Stale indicators

"Alice is typing…" that never goes away is the classic bug here. It
happens when a client crashes, closes a tab, or loses its network
mid-sentence and the stop signal never arrives. Three independent
defenses, because relying on any one alone is how the bug gets back in:

1. **Server-side TTL** — the Redis key expires after 7 seconds
   regardless of what any client sends.
2. **Client-side timeout** — `@corvidhq/chat` arms a local timer on
   `startTyping()` and stops automatically after a pause.
3. **Receiver-side expiry** — `@corvidhq/react`'s store expires a typing
   user locally after 8 seconds even if the stop frame is lost in transit.

You never see your own typing event echoed back — there's no reason a
client would need to be told it's typing.

## Next

- [Presence](/chat/presence)
- [Reactions](/chat/reactions)
