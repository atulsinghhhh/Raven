---
title: Presence
description: Ephemeral by design — why it never touches Postgres.
---

```ts
chat.on('presence', (event) => {
  console.log(`${event.userId} is ${event.status}`);
});

await chat.setPresence('away');
const present = await chat.getPresence();
// [{ userId: 'bob', status: 'online' }]
```

Statuses: `online`, `away`, `offline`.

## Presence is ephemeral, on purpose

Presence never touches Postgres. A user switching tabs would otherwise
generate two durable writes per switch, for state meaningless five
seconds later — multiplied across every user in every conversation,
that's an expensive way to store nothing of value.

It lives in Redis with a 45-second TTL, refreshed by the connection's
heartbeat every 20 seconds.

## Expiry is the offline signal

Raven doesn't rely on a client saying goodbye. A live connection keeps
its key alive; if the process holding that socket dies — a crash, an OOM
kill, a laptop lid closing — nothing announces it. The key simply
expires, and the user goes offline within 45 seconds on its own.

Marking users offline only on an explicit disconnect event fails exactly
when it matters: the cases where no disconnect event ever arrives are
the cases where a user really has gone away. A clean disconnect still
clears presence immediately, so the common case is fast — expiry is the
backstop, not the primary path.

## Change-only broadcasts

A heartbeat refreshes the TTL but does **not** broadcast. An event
publishes only when status actually changes — without that, every
connected client in a 50-person room would receive a presence event for
every other client every 20 seconds: 2,500 pointless frames a minute.

## Multiple tabs

Presence is keyed by user, not by connection. Three tabs open means one
`online`; closing one doesn't take the user offline, because the other
two keep refreshing the same key.

## Next

- [Typing Indicators](/chat/typing)
- [Delivery & Read Receipts](/chat/read-receipts)
