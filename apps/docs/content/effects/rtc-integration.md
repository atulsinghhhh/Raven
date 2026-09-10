---
title: RTC Integration
description: camera.attachEffects()/detachEffects() — how a pipeline plugs into Livqeno RTC without disconnecting or renegotiating.
---

Effects attach to a `LocalTrack` of kind `'camera'` — the same class
[Rooms & Participants](/rtc/rooms-and-participants) and
[Audio & Video](/rtc/audio-and-video) already document.

```ts
const room = await client.join('room-123');
const camera = await room.enableCamera();

const pipeline = effects.createPipeline();
pipeline.applyPreset(effects.presets.vivid);

await camera.attachEffects(pipeline);
```

## What happens on attach

1. The pipeline captures frames from the live camera track into an
   offscreen video element.
2. It picks an engine (WebGL2, Canvas2D, or passthrough) based on what
   this browser actually supports — see [Performance](/effects/performance).
3. The processed output is a new `MediaStreamTrack`. `attachEffects()`
   swaps it into the already-published sender via the SFU adapter's
   `replaceTrack()` — **no renegotiation, no reconnect, no room restart**.
   Audio and every other participant's connection are untouched.

```ts
await camera.detachEffects(); // reverts to the original, unmodified camera track
```

## Constraints

- Camera tracks only. Calling `attachEffects()` on a microphone or
  screen-share track throws `RTCError` with code `MEDIA_ERROR`.
- One pipeline per track at a time. Calling `attachEffects()` again with
  a different pipeline detaches the first automatically.
- Requires adapter support for `replaceTrack()` — every current
  `@ravenkash/rtc` build has this; it's checked defensively so a future
  adapter without it fails clearly (`MEDIA_ERROR`) instead of silently.

## What doesn't change

Existing code with no effects keeps working exactly as before:

```ts
const camera = await room.enableCamera(); // still works, unmodified
```

Effects are additive — nothing about `createRTCClient`, `Room`, or
`Track`'s existing public API changed to support this.

## Errors during processing

A GPU/rendering failure never disconnects the room. It surfaces on
`pipeline.on('error', ...)`, and the camera keeps publishing (see
[Pipeline → Failure handling](/effects/pipeline#failure-handling)).
`attachEffects()`/`detachEffects()` themselves reject only for the
constraints above (wrong track kind, no adapter support).

## Related

- [Pipeline](/effects/pipeline) — the full lifecycle and event catalogue.
- [Live Streaming Integration](/effects/live-streaming) — the same mechanism, applied to a stream host.
- [Performance](/effects/performance)
