---
title: Screen Sharing
description: Publishing a screen share with the browser's native capture.
---

```ts
await room.enableScreenShare();
```

Or, using the create-then-publish pattern:

```ts
const track = await client.createScreenShareTrack();
await room.publish(track);
```

Both use the browser's native `getDisplayMedia()` — there's no custom
capture code, and no dependency on a particular browser's screen-picker
UI.

## What's not included

Screen sharing currently surfaces **video only**. If the browser or OS
also offers a screen-share-audio track (sharing a browser tab with sound,
for instance), it isn't exposed by the SDK yet. If your application
needs system audio alongside the shared screen, that's a gap to plan
around rather than something to work around client-side.

## Stopping

```ts
await room.disableScreenShare();
```

Same shape as camera/microphone — see [Audio & Video](/rtc/audio-and-video)
for the mute-vs-unpublish distinction, which applies here too.
