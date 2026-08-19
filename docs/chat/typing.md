# Raven Chat — Typing indicators

```js
await chat.startTyping();
await chat.stopTyping();

chat.on('typing', (event) => {
  console.log(`${event.userId} ${event.isTyping ? 'started' : 'stopped'} typing`);
});
```

Safe to call `startTyping()` on every keystroke — see below.

## Never persisted

Typing events do not go into Postgres. A typing signal is meaningless seven
seconds after it happens, and writing one per keystroke would be the single
most wasteful thing in the system.

Redis, 7-second TTL, fan-out over pub/sub. That's the whole implementation.

## Stale indicators

"Alice is typing…" that never goes away is the classic bug in this feature. It
happens when a client crashes, closes a tab, or loses its network mid-sentence
and the `stop` never arrives.

Three defences, because relying on any one of them alone is how the bug gets
in:

1. **Server-side TTL.** The Redis key expires after 7 seconds regardless of
   what any client does or doesn't send.
2. **Client-side timeout.** `@corvidhq/chat` arms a local timer on
   `startTyping()` and stops automatically after a pause, so a user who
   wanders off mid-sentence stops showing as typing.
3. **Receiver-side expiry.** `@corvidhq/react`'s store expires a typing user
   locally after 8 seconds even if the `typing.stopped` frame is lost in
   transit.

## Not echoed to the typist

You never receive your own typing events. The gateway tags each event with the
connection that caused it and skips that socket on fan-out — showing someone
their own "you are typing" indicator would be noise.

## Broadcast only on transition

The server broadcasts on the transition *into* typing, not on every refresh. A
client calling `startTyping()` per keystroke produces one fan-out, not one per
character.

The SDK throttles as well (one signal per second), so a fast typist doesn't
produce a WebSocket write per keypress. Both layers exist because the
throttle is a client-side courtesy and the transition check is the server-side
guarantee.

## React

```jsx
import { useTyping } from '@corvidhq/react';

function Composer() {
  const { typingUsers, onInput, stop } = useTyping();

  return (
    <>
      <div className="typing">
        {typingUsers.length > 0 && `${typingUsers.join(', ')} typing…`}
      </div>
      <input onChange={onInput} onBlur={stop} />
    </>
  );
}
```

`onInput` is throttled and self-stopping — wire it straight to `onChange`
without thinking about it. `typingUsers` never includes you.
