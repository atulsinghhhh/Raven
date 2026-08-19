# @corvidhq/rtc — Web SDK (Phase 11 notes)

`@corvidhq/rtc` is Raven's browser SDK — it already existed before Phase 11
(built in Phase 6, extended in Phases 8–10 with telemetry/diagnostics).
**This document does not replace `docs/sdk.md`**, which remains the full
API reference (installation, `createRTCClient`, joining, camera/
microphone, tracks, participants, events, errors, reconnection,
telemetry, diagnostics, screen sharing, data messages). Read that first.
This page covers only what Phase 11 specifically added or clarified:
browser support, Next.js usage, and the small additive API surface.

## What Phase 11 added (all backward-compatible — nothing renamed or removed)

- `room.setSpeakerDevice(deviceId)` — switches audio output where the
  browser supports `HTMLMediaElement.setSinkId` (Safari doesn't; throws
  `DEVICE_NOT_FOUND` there rather than silently doing nothing).
- `client.onDeviceChange(callback)` — subscribes to camera/microphone
  connect/disconnect; returns an unsubscribe function.
- `room.on('trackMuted', ...)` / `room.on('trackUnmuted', ...)` — a
  remote participant muting/unmuting a track they already published.
- `isBrowserSupported()` / `getBrowserSupportDetails()` — see below.
- `Room.setDevice`'s `kind` parameter widened from
  `'videoinput' | 'audioinput'` to the full `DeviceKind` (adds
  `'audiooutput'`) — every existing call site is unaffected.

Everything else — `createRTCClient`, `client.join`, `room.enableCamera`/
`enableMicrophone`/`enableScreenShare`, `room.sendData`, the `RTCError`
system, telemetry, `getDiagnostics()` — is exactly what it was before
Phase 11. See `docs/sdk.md` for all of it.

## Browser support

`@corvidhq/rtc` feature-detects what it needs rather than maintaining a
user-agent allowlist:

```ts
import { isBrowserSupported, getBrowserSupportDetails } from '@corvidhq/rtc';

if (!isBrowserSupported()) {
  const { missing } = getBrowserSupportDetails();
  // missing: e.g. ['RTCPeerConnection', 'navigator.mediaDevices.getUserMedia']
}
```

In practice this means any current release of Chrome, Firefox, Safari,
or Edge — the same set `livekit-client` (the SFU implementation this SDK
hides) supports. Internet Explorer and very old mobile browser WebViews
are not supported (no `RTCPeerConnection`).

## Next.js

`@corvidhq/rtc` (and `@corvidhq/react`, see `docs/sdk/react.md`) only run in a
browser — never call `createRTCClient()` or construct anything from this
package inside a Server Component, a Route Handler, or any code that
could execute during server-side rendering. Always do so from a Client
Component (`'use client'` at the top of the file), typically inside a
`useEffect` or an event handler.

```tsx
// app/call/page.tsx — a Server Component is fine; it renders the client component below
import { CallClient } from './call-client';
export default function Page() {
  return <CallClient />;
}
```

```tsx
// app/call/call-client.tsx
'use client';
import { createRTCClient } from '@corvidhq/rtc';
// ...join inside a useEffect, never at module scope
```

If you're using `@corvidhq/react`, this is handled for you — see
`docs/sdk/react.md#nextjs`.
