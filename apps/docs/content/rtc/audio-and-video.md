---
title: Audio & Video
description: Camera, microphone, and the create-then-publish pattern.
---

## The simple path

```ts
await room.enableCamera();      // captures and publishes in one call
await room.enableMicrophone();

await room.disableCamera();     // stops publishing and releases the device
await room.disableMicrophone();
```

## Create first, publish later

For a device preview before joining — showing the user their own camera
before committing to the call:

```ts
const track = await client.createCameraTrack();
// show a preview, let the user confirm...
await room.publish(track);
```

`client.createMicrophoneTrack()` works the same way.
`room.unpublish(track)` stops publishing without touching the
enable/disable toggle state `enableCamera()`/`disableCamera()` manage.

## Errors

Camera and microphone failures raise a typed `RTCError`, never a raw
`DOMException`:

```ts
try {
  await room.enableCamera();
} catch (error) {
  if (error.code === 'CAMERA_PERMISSION_DENIED') {
    // show your own "please allow camera access" UI
  } else if (error.code === 'DEVICE_NOT_FOUND') {
    // no camera attached
  }
}
```

## Muting vs. unpublishing

`track.mute()` stops sending media but keeps the track published — the
remote side sees a muted indicator via `trackMuted`/`trackUnmuted`
rather than the participant disappearing. `room.unpublish(track)` is a
harder stop: the track is gone from the room until republished.

Use mute for a user-facing mute button. Use unpublish when the feature
itself is going away (leaving a screen share, for instance).

## Next

- [Screen Sharing](/rtc/screen-sharing)
- [Diagnostics](/rtc/diagnostics) — resolution, framerate, and bitrate
  for whatever you've published.
