---
title: Presence & Typing
description: Ephemeral by design — why neither of these touches Postgres.
---

## Presence

```ts
chat.on('presence', (event) => {
  console.log(`${event.userId} is ${event.status}`);
});

await chat.setPresence('away');
const present = await chat.getPresence();
// [{ userId: 'bob', status: 'online' }]
```

Statuses: `online`, `away`, `offline`.

### Presence is ephemeral, on purpose

Presence never touches Postgres. A user switching tabs would otherwise
generate two durable writes per switch, for state meaningless five
seconds later — multiplied across every user in every conversation,
that's an expensive way to store nothing of value.

It lives in Redis with a 45-second TTL, refreshed by the connection's
heartbeat every 20 seconds.

### Expiry is the offline signal

Raven doesn't rely on a client saying goodbye. A live connection keeps
its key alive; if the process holding that socket dies — a crash, an OOM
kill, a laptop lid closing — nothing announces it. The key simply
expires, and the user goes offline within 45 seconds on its own.

Marking users offline only on an explicit disconnect event fails exactly
when it matters: the cases where no disconnect event ever arrives are
the cases where a user really has gone away. A clean disconnect still
clears presence immediately, so the common case is fast — expiry is the
backstop, not the primary path.

### Change-only broadcasts

A heartbeat refreshes the TTL but does **not** broadcast. An event
publishes only when status actually changes — without that, every
connected client in a 50-person room would receive a presence event for
every other client every 20 seconds: 2,500 pointless frames a minute.

### Multiple tabs

Presence is keyed by user, not by connection. Three tabs open means one
`online`; closing one doesn't take the user offline, because the other
two keep refreshing the same key.

## Typing indicators

```ts
await chat.startTyping();
await chat.stopTyping();

chat.on('typing', (event) => {
  console.log(`${event.userId} ${event.isTyping ? 'started' : 'stopped'} typing`);
});
```

Safe to call `startTyping()` on every keystroke.

### Never persisted

Typing events never reach Postgres — a signal meaningless seven seconds
after it happens, and writing one per keystroke would be the single most
wasteful thing in the system. Redis, 7-second TTL, fan-out over pub/sub.
That's the whole implementation.

### Stale indicators

"Alice is typing…" that never goes away is the classic bug here. It
happens when a client crashes, closes a tab, or loses its network
mid-sentence and the stop signal never arrives. Three independent
defenses, because relying on any one alone is how the bug gets back in:

1. **Server-side TTL** — the Redis key expires after 7 seconds
   regardless of what any client sends.
2. **Client-side timeout** — `@raven/chat` arms a local timer on
   `startTyping()` and stops automatically after a pause.
3. **Receiver-side expiry** — `@raven/react`'s store expires a typing
   user locally after 8 seconds even if the stop frame is lost in transit.

You never see your own typing event echoed back — there's no reason a
client would need to be told it's typing.

## Next

- [Delivery & Read Receipts](/chat/read-receipts)
- [Reactions](/chat/reactions)
