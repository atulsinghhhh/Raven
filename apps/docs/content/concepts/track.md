---
title: Track
description: One stream of media. Camera, microphone, or screen share — Livqeno's vocabulary, never WebRTC's.
---

A track is one stream of media a participant publishes.

## Why it exists

WebRTC has no notion of what a stream is *of* — a browser cannot even choose
the ids that end up in the SDP. So a camera and a screen share look
identical on the wire. Livqeno declares the source explicitly, which is what
lets a UI put the screen share in the big tile.

## Kinds

```ts
type TrackKind = 'camera' | 'microphone' | 'screenShare' | 'unknown';
```

`unknown` is honest rather than a fallback guess: a track whose source was
never declared is reported as unknown rather than assumed to be a camera.

## Local and remote

`LocalTrack` is one you publish. `RemoteTrack` is one you subscribed to.
Both extend `Track`, which is where `attach()`/`detach()` live:

```ts
const el = track.attach();          // a <video> or <audio>, wired up
document.body.append(el);
track.detach();                     // stops playback, detaches every element
```

`attach()` gives you an element rather than asking you for one, so the SDK
can set `autoplay`, `playsInline` and `muted` correctly. Those three are the
difference between video that plays and video that silently does not.

## Muting is not unpublishing

```ts
const camera = await room.enableCamera();

await camera.mute();          // stops sending, stays published
await camera.unmute();        // instant — nothing was torn down
await room.disableCamera();   // unpublishes entirely
```

`mute()`/`unmute()` are `LocalTrack` methods. A `RemoteTrack` has no
equivalent: you cannot mute someone else's microphone, only stop
subscribing to it.

Muting keeps the track and its transceivers in place, so unmuting is instant
and a subscriber's UI keeps the participant's tile instead of tearing it down
and rebuilding it. Remote peers see `trackMuted`/`trackUnmuted`, not
`trackUnpublished`.

## Effects attach to a track

```ts
const camera = await room.enableCamera();
await camera.attachEffects(pipeline);
```

Camera tracks only — calling it on a microphone throws `MEDIA_ERROR`. The
swap happens without renegotiating, so nobody else in the room notices.

## Related

- [Tracks & publishing](/rtc/tracks) — the full lifecycle.
- [Effects](/effects) · [Screen sharing](/rtc/screen-sharing)
