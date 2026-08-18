# Raven Chat — Presence

Who is here right now.

```js
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
generate two durable writes per switch, for state that is meaningless five
seconds later — and multiplied across every user in every conversation, that's
a genuinely expensive way to store nothing of value.

It lives in Redis with a 45-second TTL, refreshed by the connection's
heartbeat every 20 seconds.

## Expiry is the offline signal

This is the part worth understanding, because it's what makes presence
survive things that would otherwise break it.

Raven does not rely on a client saying goodbye. A live connection keeps its
key alive; if the process holding that socket dies — a crash, an OOM kill, a
`docker kill`, a laptop lid closing — nothing announces it. The key simply
expires, and the user goes offline on its own within 45 seconds.

The alternative, marking users offline on an explicit disconnect event, fails
exactly when it matters: the cases where no disconnect event ever arrives are
the cases where a user really has gone away.

A clean disconnect does clear presence immediately, so the common case is
fast. Expiry is the backstop, not the primary path.

## Change-only broadcasts

A heartbeat refreshes the TTL but does **not** broadcast. An event is only
published when the status actually changes.

Without that, every connected client would receive a presence event for every
other client every 20 seconds — in a 50-person room, 2 500 pointless frames a
minute.

## Multiple tabs

Presence is keyed by user, not by connection. Three tabs open means one
`online`; closing one of them doesn't take the user offline, because the other
two keep refreshing the same key.

## Listing

```js
const present = await chat.getPresence('conv_9WcQ…');
```

Backed by a Redis sorted set of `userId → expiry`, so listing a room is one
`ZRANGEBYSCORE` rather than a `SCAN` across the keyspace. Expired entries are
pruned in the same pass, so the index self-heals whenever anyone looks.

`room.joined` already carries the current presence list, so a client joining
mid-conversation isn't blind until the next event.

## When Redis is down

Presence stops working. Nobody appears online, `getPresence()` returns an
error, and no presence events fire.

Messages keep sending, storing, and appearing in history. Presence is a
nice-to-have, and a Redis outage degrades it rather than taking chat down —
see [architecture.md](architecture.md#failure-behaviour).

## React

```jsx
import { usePresence } from '@raven/react';

function PresenceList() {
  const presence = usePresence(); // { alice: 'online', bob: 'away' }
  return (
    <ul>
      {Object.entries(presence).map(([userId, status]) => (
        <li key={userId} className={status}>{userId}</li>
      ))}
    </ul>
  );
}
```
