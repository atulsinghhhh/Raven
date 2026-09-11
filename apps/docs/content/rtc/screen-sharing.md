---
title: Screen Sharing
description: Publishing a screen share — Web and Flutter today; not yet on React Native.
---

<Tabs>
<Tab title="Web">

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

</Tab>
<Tab title="Flutter">

```dart
await room.enableScreenShare();
```

Works out of the box on Android. **iOS needs a Broadcast Upload
Extension** — a target you add in Xcode, not something the package can
provide. Without it, `enableScreenShare()` throws. See
[Flutter SDK](/sdk/flutter#production) for the current state of a
written walkthrough.

</Tab>
</Tabs>

**Not available on React Native yet.** `@ravenkash/react-native` reuses
the same `Room` class as web and Flutter for camera/microphone, but
mobile screen capture needs its own native integration per platform
(ReplayKit on iOS, `MediaProjection` on Android) that hasn't been built.
Calling `enableScreenShare()` there is not documented and should not be
relied on.

## A known rough edge: source labelling

A subscriber normally learns that a track is a screen share from the
`source` Livqeno announces, which the publisher declares alongside the track.
That declaration is matched to the track by the id in the SDP `msid`.

When a screen share is published onto a transceiver the SFU had already
created for it, the browser can leave the SFU's own `msid` in the
m-section — Chrome will not rewrite an id it inherited from the remote
offer. The SDK offers once more to get its ids onto the wire, and warns if
that does not take. When it does not, the SFU falls back to inferring the
source from the codec kind, which reads a screen share as a camera: the
media arrives and plays, but a layout keyed on `track.kind` may put the
shared window in the face tile.

Publishing the screen share on its own transceiver would settle it, and is
not shipped because this SFU does not answer a client offer that adds
m-sections — the publish would never complete. It needs an SFU-side change.
Until then, a layout that must be certain should carry its own hint (a data
message, or your own participant metadata) rather than relying on `source`
for a screen share.

## What's not included (Web and Flutter)

Screen sharing currently surfaces **video only**. If the browser or OS
also offers a screen-share-audio track (sharing a browser tab with sound,
for instance), it isn't exposed by the SDK yet. If your application
needs system audio alongside the shared screen, that's a gap to plan
around rather than something to work around client-side.

## Stopping

<Tabs>
<Tab title="Web">

```ts
await room.disableScreenShare();
```

</Tab>
<Tab title="Flutter">

```dart
await room.disableScreenShare();
```

</Tab>
</Tabs>

Same shape as camera/microphone on both platforms — see
[Audio & Video](/rtc/audio-and-video) for the mute-vs-unpublish
distinction, which applies here too.

## Expected behavior

A remote participant sees a screen share exactly like any other video
track — it arrives via `trackSubscribed`/`participantChanges` and
attaches the same way. There's no separate "screen share" event; the
track's `kind` is what distinguishes it (`'screenShare'`).

## Common errors

| Error | Why | Fix |
|---|---|---|
| User cancels the browser's share picker | No error thrown, `enableScreenShare()`'s promise rejects. | Treat a rejection here as "user declined," not a real failure. |
| `enableScreenShare()` throws on iOS (Flutter) | No Broadcast Upload Extension configured. | Add one in Xcode — there's no software-only workaround. |

## Production notes

- Don't assume screen share is available — check the platform before
  showing the button, especially on React Native.
- A screen share ending unexpectedly (user stops sharing from the OS
  chrome, not your UI) still fires the normal unpublish path — listen
  for it rather than assuming your own button is the only way it stops.

## Related

- [Audio & Video](/rtc/audio-and-video) — the enable/disable/mute model this reuses.
- [Rooms & Participants](/rtc/rooms-and-participants) — the track model.
