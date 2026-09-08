---
title: Add screen sharing
description: Publish a screen share alongside the camera, render it large, and handle the user stopping it from the browser.
---

## What we're building

A screen-share button on an existing call. When it is on, the shared screen
becomes the primary tile and the camera moves to a thumbnail.

## Prerequisites

- A working call — [Build a video call](/guides/build-a-video-call).
- A token with `publish: true`.
- **Web or Flutter.** React Native cannot capture a screen — see
  [Screen sharing](/rtc/screen-sharing).

## Implementation

### 1. Toggle it

<Tabs>
<Tab title="Web">

```ts
async function toggleScreenShare() {
  const existing = room.localParticipant.tracks.find((t) => t.kind === 'screenShare');

  if (existing) {
    await room.disableScreenShare();
  } else {
    await room.enableScreenShare();   // triggers the browser's picker
  }
}
```

</Tab>
<Tab title="Flutter">

```dart
Future<void> toggleScreenShare(RavenRoom room) async {
  final sharing = room.localParticipant.tracks.any(
    (t) => t.kind == RavenTrackKind.screenShare,
  );
  if (sharing) {
    await room.disableScreenShare();
  } else {
    await room.enableScreenShare();
  }
}
```

</Tab>
</Tabs>

`enableScreenShare()` returns the `LocalTrack` it published, or `undefined`
if a share was already running.

### 2. Feature-detect before showing the button

A mobile browser has no `getDisplayMedia`, and a button that always throws
is worse than no button:

```ts
// Raven's own check covers the three APIs a call needs at all:
import { getBrowserSupportDetails } from '@corvidhq/rtc';

const { supported, missing } = getBrowserSupportDetails();
if (!supported) showUnsupportedBrowserNotice(missing);

// Screen capture is a separate capability and not part of that check,
// so test for it directly:
const canShareScreen = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
if (!canShareScreen) hideScreenShareButton();
```

If you call it anyway on an unsupported platform you get
`NOT_SUPPORTED` — a permanent fact about the device, deliberately distinct
from `MEDIA_ERROR`, which is worth retrying.

### 3. Render it large

A screen share is just a track with `kind === 'screenShare'`, so promote it
in your layout:

```ts
room.on('trackSubscribed', (track, participant) => {
  const target = track.kind === 'screenShare' ? stageEl : thumbnailsEl;
  target.append(track.attach());
});
```

<Tabs>
<Tab title="React">

```tsx
import { ParticipantView, useRemoteParticipants } from '@corvidhq/react';

function Stage() {
  const remote = useRemoteParticipants();
  const sharer = remote.find((p) => p.tracks.some((t) => t.kind === 'screenShare'));

  // ParticipantView renders whichever video track the participant has,
  // preferring camera or screen share — so promoting the sharer to the
  // stage is all this needs.
  return sharer ? <ParticipantView participant={sharer} /> : <CameraGrid />;
}
```

</Tab>
</Tabs>

### 4. Handle the browser's own Stop button

This is the step people miss. The browser puts its own "Stop sharing" UI on
screen, and when the user clicks it your application is not told through
Raven — the underlying media track simply ends:

```ts
const share = await room.enableScreenShare();

share?.mediaStreamTrack.addEventListener('ended', () => {
  void room.disableScreenShare();   // keep Raven's state in step with the browser's
  setSharing(false);                // and your UI in step with both
});
```

Without this, your button says "Stop sharing" for a share that stopped
thirty seconds ago.

## How it works

**A screen share is a normal published track with a declared source.**
WebRTC has no notion of what a stream is *of*, and a page cannot choose the
ids that land in the SDP — so a camera and a screen share are
indistinguishable on the wire. Raven declares the source explicitly in a
`track.publish` frame, which is what lets every other client put the share
in the big tile.

**It is a second video track, not a replacement.** Camera and share are
published together, and remote participants receive both. That is why your
layout needs a rule for which is primary rather than just rendering
"the video track".

**Publishing does not renegotiate the whole session.** The track is added to
the existing peer connection; nobody else's call is interrupted.

## Production considerations

- **Screen share is high-bitrate and high-resolution.** A shared 4K display
  costs far more than a camera. Consider constraining it, and expect it to
  be the first thing to suffer on a poor connection.
- **Only one share per participant.** Calling `enableScreenShare()` twice
  returns `undefined` the second time rather than publishing two.
- **React Native has no path to this.** Not a gap in Raven's API — the
  platform module does not capture the screen. Do not ship a button that
  cannot work.
- **Audio capture is not included.** `enableScreenShare()` publishes video.
  Tab audio is not captured.

## Next steps

- [Screen sharing](/rtc/screen-sharing) — the per-platform reference.
- [Tracks & publishing](/rtc/tracks) · [Browser support](/sdk/browser-support)
