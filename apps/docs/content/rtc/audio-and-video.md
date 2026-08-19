---
title: Audio & Video
description: Camera, microphone, and the create-then-publish pattern — on Web, React, React Native, and Flutter.
---

Enabling a device captures it **and** publishes it to the room in one
call, on every SDK — there's no separate `publish()` step for the common
case.

**Prerequisites:** joined a room (see [Quickstart](/rtc/quickstart)) with
a token whose `publish` permission is `true` — see
[Authentication](/rtc/authentication).

## The simple path

<Tabs>
<Tab title="Web">

```ts
await room.enableCamera();      // captures and publishes in one call
await room.enableMicrophone();

await room.disableCamera();     // stops publishing and releases the device
await room.disableMicrophone();
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useCamera, useMicrophone } from '@corvidhq/react';

function DeviceControls() {
  const camera = useCamera();
  const microphone = useMicrophone();

  return (
    <>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())} disabled={camera.busy}>
        Camera: {camera.enabled ? 'on' : 'off'}
      </button>
      <button onClick={() => (microphone.enabled ? microphone.disable() : microphone.enable())}>
        Mic: {microphone.enabled ? 'on' : 'off'}
      </button>
      {camera.error && <p role="alert">{camera.error.code}</p>}
    </>
  );
}
```

`{ enabled, track, enable(), disable(), error }` — no `busy` flag on
web; that's a React Native/Flutter-only concern (device acquisition is
noticeably slower on a phone, so a double-tap is worth guarding against
there specifically).

</Tab>
<Tab title="React Native">

```tsx
import { useCamera, useMicrophone } from '@corvidhq/react-native';

function DeviceControls({ room }) {
  const camera = useCamera(room);       // { enabled, busy, enable(), disable(), toggle(), error }
  const microphone = useMicrophone(room);

  return (
    <>
      <Button onPress={camera.toggle} disabled={camera.busy} title={camera.enabled ? 'Camera on' : 'Camera off'} />
      <Button onPress={microphone.toggle} title={microphone.enabled ? 'Mic on' : 'Mic off'} />
    </>
  );
}
```

`busy` is true while a slow camera acquisition is in flight — disable
the button on it, or a user's second tap races the first.

</Tab>
<Tab title="Flutter">

```dart
await room.enableCamera();
await room.disableCamera();
await room.enableMicrophone();
await room.disableMicrophone();
```

</Tab>
</Tabs>

## Create first, publish later

For a device preview before joining — showing the user their own camera
before committing to the call. Web-only today; React Native and Flutter
always capture-and-publish together via `enableCamera()`.

```ts
const track = await client.createCameraTrack();
// show a preview, let the user confirm...
await room.publish(track);
```

`client.createMicrophoneTrack()` works the same way.
`room.unpublish(track)` stops publishing without touching the
enable/disable toggle state `enableCamera()`/`disableCamera()` manage.

## Filters & Effects

A published camera track can run through a
[Raven Effects](/effects) pipeline before anyone downstream sees it —
brightness, contrast, saturation, and presets like `cinematic`/`vivid`,
without touching SDP, WebGL, or a canvas directly:

```ts
import { effects } from '@corvidhq/effects';

const camera = await room.enableCamera();
const pipeline = effects.createPipeline();
pipeline.applyPreset(effects.presets.cinematic);

await camera.attachEffects(pipeline);
```

`attachEffects()` swaps the published track in place via the SFU
adapter's `replaceTrack()` — the room stays connected, audio is
untouched, and remote participants receive the processed video through
the ordinary `trackSubscribed` event. See [Effects → RTC Integration](/effects/rtc-integration)
for the full API, and [Effects → React Native](/effects/react-native) /
[Effects → Flutter](/effects/flutter) for current mobile status.

## Errors

Camera and microphone failures raise a typed error, never a raw
platform exception, on every SDK:

<Tabs>
<Tab title="Web">

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

</Tab>
<Tab title="React Native">

```ts
import { isRavenPermissionError } from '@corvidhq/react-native';

try {
  await room.enableCamera();
} catch (error) {
  if (isRavenPermissionError(error)) {
    if (error.requiresSettings) {
      // "blocked" — re-prompting does nothing; send the user to Settings
    } else {
      // "denied" — a normal prompt may still work next time
    }
  }
}
```

`RavenPermissionError` *is* an `RTCError` — existing `if (isRTCError(e))` code keeps working unchanged. See [Permissions](/rtc/permissions).

</Tab>
<Tab title="Flutter">

```dart
try {
  await room.enableCamera();
} on RavenPermissionException catch (e) {
  if (e.permanentlyDenied) {
    // send the user to system settings
  }
} on RavenException catch (e) {
  if (e.code == RavenErrorCode.deviceNotFound) {
    // no camera attached
  }
}
```

</Tab>
</Tabs>

## Muting vs. unpublishing

`track.mute()` stops sending media but keeps the track published — the
remote side sees a muted indicator via `trackMuted`/`trackUnmuted`
rather than the participant disappearing. `room.unpublish(track)` is a
harder stop: the track is gone from the room until republished.

Use mute for a user-facing mute button. Use unpublish when the feature
itself is going away (leaving a screen share, for instance).

## Expected behavior

Enabling a device that's already enabled is a no-op. Disabling a device
that was never enabled is also a no-op — neither throws. A remote
participant's `trackMuted`/`trackUnmuted`/`trackSubscribed`/
`trackUnsubscribed` events fire regardless of which SDK published the
track; the events are the same across platforms because it's the same
`Room` class underneath.

## Production notes

- Request camera/microphone access close to when you actually need it
  (joining a call), not on app launch — an unexplained permission prompt
  gets declined far more often than one with context.
- On React Native/Flutter, a denied-vs-blocked distinction changes the
  UI you should show — see [Permissions](/rtc/permissions).
- Don't poll device state; subscribe to `trackMuted`/`trackUnmuted`/
  `localTrackPublished`/`localTrackUnpublished` instead.

## Related

- [Screen Sharing](/rtc/screen-sharing) — the same enable/disable shape.
- [Permissions](/rtc/permissions) — OS-level camera/microphone access across platforms.
- [Diagnostics](/rtc/diagnostics) — resolution, framerate, and bitrate for whatever you've published.
