---
title: Participant
description: One identity in one room. Local or remote, with the tracks it publishes.
---

A participant is one identity present in one room.

## Why it exists

Media has to be attributable. A `Track` on its own is a stream of bytes;
what a UI needs is "Alice's camera". The participant is what makes a track
renderable next to a name.

## Identity comes from you

The `identity` string is whatever your backend put in the token —
`user-42`, a UUID, an email. Livqeno does not know or care what it means, only
that it is unique within the room. Letters, numbers, `-`, `_` and `.`, up
to 128 characters.

Because identity is signed into the token, a participant cannot claim to be
someone else.

## Local and remote

```ts
room.localParticipant;      // you
room.remoteParticipants;    // everyone else
```

`LocalParticipant` and `RemoteParticipant` are different types on purpose:
you can publish from the local one and only subscribe to the remote ones.

## Minimal example

```ts
room.on('participantJoined', (participant) => {
  console.log(participant.identity, participant.tracks.length);
});

for (const p of room.remoteParticipants) {
  const camera = p.tracks.find((t) => t.kind === 'camera');
  if (camera) container.append(camera.attach());
}
```

## Related

- [Track](/concepts/track) — what a participant publishes.
- [Room](/concepts/room) · [Events](/rtc/events)
