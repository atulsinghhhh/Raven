---
title: Browser Support
description: What Livqeno needs from a browser, what it checks, and the honest state of interop testing.
---

## What a call needs

Three platform APIs:

| API | Used for |
|---|---|
| `RTCPeerConnection` | The media connection |
| `navigator.mediaDevices.getUserMedia` | Camera and microphone capture |
| `WebSocket` | Signaling and chat |

## Check before you render

```ts
import { getBrowserSupportDetails, isBrowserSupported } from '@ravenkash/rtc';

if (!isBrowserSupported()) {
  showUnsupportedNotice();
}

const { supported, missing } = getBrowserSupportDetails();
// missing: ['RTCPeerConnection'] — name the thing that is absent
```

`missing` names each absent API, so your notice can say what is wrong
rather than "your browser is unsupported".

## Capabilities checked separately

`getBrowserSupportDetails()` covers the three APIs a call cannot start
without. Optional capabilities are not part of it and need their own test:

| Capability | Test | Absent on |
|---|---|---|
| Screen sharing | `typeof navigator.mediaDevices?.getDisplayMedia === 'function'` | Mobile browsers |
| Speaker selection | `'setSinkId' in HTMLMediaElement.prototype` | Safari |
| Camera effects | `detectCapabilities()` from `@ravenkash/effects` | Anything without WebGL |

Calling an unsupported operation throws `NOT_SUPPORTED` — deliberately
distinct from `MEDIA_ERROR`, because "this device cannot do this" is
permanent and should hide a button, while `MEDIA_ERROR` is worth retrying.

## Interop testing: read this before you promise anything

**Only Chromium has been exercised with real media.** Firefox, Safari and
Edge are untested end to end.

Support is **feature-detected**, so an untested browser reports as
supported. That is a claim about capabilities, not about interop — the APIs
are present, and whether the whole media path works has not been verified.

| Browser | Feature detection | Real-media testing |
|---|---|---|
| Chrome / Edge (Chromium) | Passes | **Verified** |
| Firefox | Passes | Not tested |
| Safari (macOS) | Passes | Not tested |
| Safari (iOS) | Passes | Not tested |

If you ship to a broad audience, test on the browsers your users actually
have. This is the largest untested surface in the client stack, and it is
recorded in [Known limitations](/reference/known-limitations).

## Known platform quirks

Real constraints of the platforms, not Livqeno bugs:

- **iOS Safari needs `playsInline`.** `track.attach()` sets it. This is
  why `attach()` returns an element instead of asking for one — video that
  silently refuses to play is otherwise the outcome.
- **Autoplay needs a gesture.** A remote audio element may refuse to start
  until the user has interacted with the page. Put your join behind a
  button.
- **`setSinkId` is absent in Safari.** `setSpeakerDevice()` throws
  `DEVICE_NOT_FOUND` there rather than quietly doing nothing.
- **No screen capture on mobile browsers.** Feature-detect and hide the
  button.
- **Device labels are empty before permission.** Enumerate again after
  `getUserMedia` succeeds, or your picker shows blank entries.

## Server-side rendering

`@ravenkash/rtc`, `@ravenkash/chat` and every `@ravenkash/react` hook are
browser-only. In Next.js, mark the component:

```tsx
'use client';
```

`<RavenRoom>` and every hook must run in the browser. See
[Web SDK](/sdk/web#nextjs).

## Next steps

- [SDKs](/sdk) · [RTC troubleshooting](/rtc/troubleshooting)
- [Known limitations](/reference/known-limitations)
