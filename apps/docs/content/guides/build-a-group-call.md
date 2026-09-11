---
title: Build a group call
description: A participant grid that behaves when the room fills up — subscription, layout, and the limits that matter.
---

## What we're building

A call for more than two people: a grid that adds and removes tiles as
participants come and go, publishes one camera and one microphone, and does
not fall over at fifteen people.

The difference from a two-person call is not the API. It is that you now
have to think about how much media you are receiving.

## Prerequisites

- A working two-person call — [Build a video call](/guides/build-a-video-call).
- A project and an API key.

## Implementation

### 1. Mint a token per participant

Same call as before, once per person joining:

```ts
const credentials = await raven.tokens.create({
  room: room.id,
  identity: user.id,
  permissions: { join: true, subscribe: true, publish: true },
});
```

There is no "group room" type. A room is a room; the number of tokens you
mint against it is what makes it a group call.

### 2. Render from the roster, not from events

With two people you can append an element on `trackSubscribed`. With ten,
you want one source of truth:

<Tabs>
<Tab title="React">

```tsx
import { ParticipantView, useRemoteParticipants, useLocalParticipant } from '@ravenkash/react';

function Grid() {
  const local = useLocalParticipant();
  const remote = useRemoteParticipants();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns(remote.length + 1)}, 1fr)` }}>
      {local && <ParticipantView participant={local} />}
      {remote.map((p) => (
        <ParticipantView key={p.identity} participant={p} />
      ))}
    </div>
  );
}

function columns(count: number) {
  return count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
}
```

</Tab>
<Tab title="Web">

```ts
function render() {
  const everyone = [room.localParticipant, ...room.remoteParticipants];
  grid.replaceChildren();

  for (const p of everyone) {
    const tile = document.createElement('div');
    tile.dataset.identity = p.identity;

    const camera = p.tracks.find((t) => t.kind === 'camera');
    if (camera) tile.append(camera.attach());

    grid.append(tile);
  }
}

for (const event of ['participantJoined', 'participantLeft', 'trackSubscribed', 'trackUnsubscribed'] as const) {
  room.on(event, render);
}
```

Re-rendering from the roster on every relevant event is less code than
patching the DOM per event, and it cannot drift out of sync.

</Tab>
</Tabs>

### 3. Cap how many tiles you render

The one thing that actually changes at scale. If your UI shows nine tiles
and the room has thirty people, you are decoding twenty-one video streams
nobody can see.

Today the lever available to you is **what you render**, not what you
subscribe to:

```tsx
const MAX_TILES = 9;
const shown = remote.slice(0, MAX_TILES);
const overflow = remote.length - shown.length;
```

Detaching a track stops it playing, which is what saves the decode:

```ts
// When a tile leaves the visible set.
track.detach();
```

Audio has no equivalent problem — it is cheap, and you want all of it.

> **Per-participant simulcast layer selection is not exposed on the web
> SDK.** The signaling protocol carries a `subscription.update` frame and
> the Flutter SDK exposes `RavenRoom.requestLayer(...)`, but
> `@ravenkash/rtc` neither sends the frame nor offers a method for it. If
> you need explicit layer control today, Flutter is the only SDK that has
> it. Tracked in [Known limitations](/reference/known-limitations).

### 4. Watch bandwidth, not "who is speaking"

Livqeno does not emit an active-speaker event. What it does give you is real
per-track statistics, which is enough to drive a bandwidth warning:

```ts
setInterval(async () => {
  const stats = await room.getConnectionStats();
  const struggling = stats.remote.filter((t) => (t.packetLossPercent ?? 0) > 5);
  if (struggling.length) showNetworkWarning(struggling.length);
}, 5000);
```

Poll every few seconds, not on a tight loop — each call costs a round trip
through the platform's stats API per track.

## How it works

**Every client has exactly one peer.** Not one per participant — one, the
media server serving the room. That is what makes a group call possible at
all: a full mesh at fifteen people would need each browser to maintain
fourteen peer connections and encode fourteen times.

**The room's track set changes, and the server re-offers.** When someone
publishes, Livqeno sends a new offer to everyone subscribed. Your code sees
`trackPublished`, then `trackSubscribed` when the media actually arrives.
Those are two different moments, and rendering on the first one gives you an
empty tile.

**Participant caps are per room.** 50 by default
(`SIGNALING_MAX_PARTICIPANTS_PER_ROOM`). A join past the cap is refused with
`ROOM_FULL` rather than degrading silently.

## Production considerations

- **Measure before you trust a number.** Livqeno's own scale tests reach 100
  participants on loopback with synthetic media. That is not a capacity
  figure for real networks and real cameras, and it is not quoted as one.
- **How many tiles you render is the lever that matters.** Every
  subscribed video track is decoded whether or not it is attached to a
  visible element, so detach the ones you hide.
- **Congestion control is not wired up yet.** The media server collects
  TWCC feedback but nothing consumes it to drive layer selection
  automatically. A subscriber on a degrading connection sees loss rather
  than an automatic downgrade. Combined with the missing web-side layer
  control above, this is the weakest part of the stack at scale today. See
  [Known limitations](/reference/known-limitations).
- **Cap your grid.** Decide the maximum tiles you will render and page or
  prioritise beyond that. A 30-tile grid is unusable regardless of what the
  network can carry.

## Next steps

- [Tracks & publishing](/rtc/tracks) — layers and subscription in detail.
- [Handle reconnection](/guides/handle-reconnection) — more people means more drops.
- [Limits & quotas](/reference/limits)
