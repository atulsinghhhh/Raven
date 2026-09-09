---
title: Tracks & Publishing
description: The publish lifecycle, mute versus unpublish, device switching, and attaching media to the DOM.
---

A track is one stream of media. This page is the lifecycle: creating,
publishing, rendering, muting, and taking it down.

## Two ways to publish

The short way covers most applications:

```ts
const camera = await room.enableCamera();
const mic = await room.enableMicrophone();
const share = await room.enableScreenShare();
```

Each captures, publishes, and returns the `LocalTrack` — or `undefined` if
that source was already on.

The explicit way, when you need the track before it is published — a
pre-join preview, a specific device, effects applied first:

```ts
const track = await client.createCameraTrack(deviceId);
// inspect, attach locally, apply effects…
await room.publish(track);
```

```ts
await room.unpublish(track);
track.stop();               // release the camera light
```

`unpublish()` stops sending. `stop()` releases the hardware. Do both when
you are finished with a track you created yourself.

## Rendering

```ts
const element = track.attach();
container.append(element);
```

`attach()` returns an element rather than taking one, so the SDK can set
`autoplay`, `playsInline` and `muted` correctly. Those three are the
difference between video that plays and video that silently does not,
especially on iOS Safari.

Pass your own element when you need to control it:

```ts
track.attach(myVideoElement);
```

Then clean up:

```ts
track.detach();                  // every element this track is attached to
track.detach(myVideoElement);    // just one
```

`detach()` stops playback, which is what actually saves the decode when a
tile scrolls out of view.

## Mute is not unpublish

```ts
await camera.mute();      // stop sending, stay published
await camera.unmute();    // instant
```

Muting keeps the track and its transceivers in place. Unmuting needs no
renegotiation, and remote peers see `trackMuted`/`trackUnmuted` rather
than `trackUnpublished` — so their UI keeps your tile and shows a badge
instead of tearing the tile down and rebuilding it.

Unpublishing removes the track entirely. Use mute for "microphone off",
unpublish for "camera feature turned off".

`mute()`/`unmute()` are `LocalTrack` methods. You cannot mute someone
else's track — only stop subscribing to it.

## Track kinds

```ts
type TrackKind = 'camera' | 'microphone' | 'screenShare' | 'unknown';
```

`unknown` is honest rather than a fallback guess. WebRTC carries no notion
of what a stream is *of*, so Raven declares the source explicitly when
publishing; a track that arrives without one is reported as unknown rather
than assumed to be a camera.

That declaration is why every other client can put a screen share in the
big tile.

## Devices

```ts
const cameras = await client.getDevices('videoinput');
const mics = await client.getDevices('audioinput');
const speakers = await client.getDevices('audiooutput');

await room.setCameraDevice(cameras[0].deviceId);
await room.setMicrophoneDevice(mics[0].deviceId);
await room.setSpeakerDevice(speakers[0].deviceId);
```

Switching a device replaces the media on the already-published track — no
renegotiation, and nobody else in the room notices.

`setSpeakerDevice()` needs `HTMLMediaElement.setSinkId`, which Safari does
not implement; there it throws `DEVICE_NOT_FOUND` rather than silently
doing nothing.

React to devices appearing and disappearing:

```ts
const stop = client.onDeviceChange(async () => {
  setCameras(await client.getDevices('videoinput'));
});
```

On Flutter, `room.switchCamera()` flips front/rear — a phone-specific
concern with no web equivalent.

## Effects

```ts
const camera = await room.enableCamera();
await camera.attachEffects(pipeline);
await camera.detachEffects();
```

Camera tracks only; calling it on a microphone throws `MEDIA_ERROR`. The
processed track is swapped onto the existing sender, so no renegotiation
happens and no remote participant sees an interruption. See
[Effects](/effects/rtc-integration).

## Per-track statistics

```ts
const stats = await track.getStats();
// bitrateBps (bits per second), packetsLost, packetLossPercent,
// jitterMs, roundTripTimeMs, codec, frameWidth, frameHeight, framesPerSecond
```

`bitrateBps` is `undefined` on a track's first sample — there is nothing to
diff against yet. `roundTripTimeMs` appears only on send-direction tracks,
because WebRTC never reports a receiver's own RTT. `codec` appears only on
received video.

For the whole room at once, use
[`room.getConnectionStats()`](/rtc/diagnostics).

## Simulcast layers

Video is published in multiple qualities where the platform supports it,
and the media server forwards the layer a subscriber can use.

Explicit per-participant layer selection is exposed on **Flutter only**
today — `RavenRoom.requestLayer(participant, kind, layer)`. The signaling
protocol carries the frame, but `@ravenkash/rtc` neither sends it nor offers
a method. On the web, control what you render and `detach()` what you hide.
See [Known limitations](/reference/known-limitations).

A layer switch also needs keyframe detection, which covers VP8, VP9 and
H.264. On AV1 or H.265 a switch cannot complete, so single-layer is the
practical choice there.

## Next steps

- [Audio & video](/rtc/audio-and-video) — the per-platform reference.
- [Screen sharing](/rtc/screen-sharing) · [Events](/rtc/events) · [Diagnostics](/rtc/diagnostics)
