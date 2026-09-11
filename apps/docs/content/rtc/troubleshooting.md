---
title: Troubleshooting
description: Browser support, common failure modes, and what to check first.
---

## Checking browser support

```ts
import { isBrowserSupported, getBrowserSupportDetails } from '@ravenkash/rtc';

if (!isBrowserSupported()) {
  const { missing } = getBrowserSupportDetails(); // e.g. ['RTCPeerConnection']
}
```

Feature-detected against what the browser actually implements, not a
hardcoded user-agent allowlist — a browser that's missing today's
detected APIs but ships them next release starts working automatically.

## Black video, no error

Almost always a permissions issue, not a code bug. Check
`getBrowserSupportDetails()` and confirm the camera permission was
actually granted — a silently-denied permission produces a track that
never starts, not a thrown error. On React Native/Flutter, call
`permissions.check()`/check the OS settings directly — see
[Permissions](/rtc/permissions).

## No audio, or a remote track plays from the wrong device

**Autoplay restrictions.** Browsers, Safari especially, require a user
gesture (or a muted `<video>`) before audio plays. If you attach a track
programmatically before any user interaction, set `muted` initially and
unmute on the first click.

## Screen share has no audio

Expected — see [Screen Sharing](/rtc/screen-sharing#whats-not-included-web-and-flutter).
Screen-share audio isn't currently surfaced even when the OS/browser
provides it.

## Device labels are empty

Labels populate only once permission has been granted at least once —
this is a browser privacy behavior, not something the SDK can bypass.
Call `client.getDevices()` again after the first successful
`enableCamera()`/`enableMicrophone()`.

## A call fails to connect at all

1. Confirm the token hasn't expired — tokens are deliberately short-lived.
2. Confirm `iceServers` was forwarded from the token response, not
   hand-constructed — a missing TURN server is the most common cause of
   "works on Wi-Fi, fails on a cellular or corporate network."
3. Check `error.code` — `ROOM_NOT_FOUND` means the `roomId` passed to
   `join()` doesn't match what the token was minted for.

## Mobile

React Native and Flutter are both officially supported —
[React Native](/sdk/react-native) and [Flutter](/sdk/flutter) reuse the
same RTC and chat logic as the web SDK, so a bug fix generally lands on
both platforms at once. Mobile-specific concerns: [Permissions](/rtc/permissions)
(camera/mic prompts differ by platform), [Background Audio](/rtc/background-audio)
(React Native only), and audio routing on each SDK's own page.

## "RTCPeerConnection is not defined" (React Native)

The WebRTC globals weren't registered. Constructing a `Raven` does this
automatically; if you touch WebRTC before that (e.g. rendering a
pre-join camera preview), call `bootstrapRavenNative()` yourself first,
in `index.js`.

## App crashes instantly when asking for camera/microphone (React Native, Flutter)

Missing `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` in
`Info.plist`. iOS terminates the process rather than erroring — see
[Permissions](/rtc/permissions#platform-manifestplist-setup).

## What's genuinely not there yet

- Per-participant live connection state and metadata updates aren't
  exposed — only identity, metadata-at-join-time, and tracks.
- Data messages have no reliability options or per-participant
  targeting. Use [Chat](/chat) if you need either.

If you hit something not covered here, open an issue on
[GitHub](https://github.com/atulsinghhhh/Raven/issues) — include the SDK version, the browser, and anything
`room.on('error')` reported.
