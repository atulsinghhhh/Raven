---
title: Room
description: Where an audio/video session happens. A control-plane record, not a running server.
---

A room is where participants meet to exchange audio and video.

## Why it exists

It is the unit a [token](/concepts/token) is scoped to, and the unit the
media plane allocates a server for. Two participants are in a call together
because they hold tokens for the same room.

## It is a record, not infrastructure

Creating a room writes a row. It does not start a server. A media server is
allocated when the first participant actually joins, and released when the
last one leaves.

This is why deleting a room is a **soft close** — it sets the status to
`CLOSED` rather than destroying history:

```ts
await raven.rooms.delete(roomId);   // status → CLOSED
```

## Identity

A room has an id (a UUID) and a name (yours, unique within the project and
environment). Mint tokens against the **id**. When joining, the SDK accepts
either, because the token carries both.

```ts
const room = await raven.rooms.create({ name: 'support-room' });
await raven.tokens.create({ room: room.id, identity: 'alice' });
```

## Capacity

The signaling layer caps participants per room — 50 by default, set by
`SIGNALING_MAX_PARTICIPANTS_PER_ROOM`. A join past the cap is refused with
`ROOM_FULL`.

## Live participants

The roster is live SFU state, not a stored list:

```ts
const participants = await raven.rooms.participants.list(roomId);
// null means the media server could not be reached — different from "empty"
```

`null` and `[]` mean different things, and the SDK keeps them apart rather
than flattening a failure into "nobody here".

## Related

- [Participant](/concepts/participant) · [Track](/concepts/track)
- [Rooms & participants](/rtc/rooms-and-participants) — the SDK surface.
- [RTC API](/api/rtc) — the REST surface.
