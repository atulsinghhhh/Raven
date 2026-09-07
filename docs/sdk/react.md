# @corvidhq/react — React hooks & optional UI primitives

React integration on top of `@corvidhq/rtc` — Phase 11's main deliverable.
Headless by default (hooks work with any UI you build), plus a handful
of genuinely optional components for a fast start. `@corvidhq/rtc` itself
was not rewritten to build this — see `docs/sdk/web.md` for exactly what
changed there (small, additive, non-breaking).

## Installation

```bash
npm install @corvidhq/rtc @corvidhq/react
```

Peer dependencies: `react` and `react-dom` `^18 || ^19`.

## Quickstart

```tsx
'use client';
import { RavenRoom, useConnectionState, useLocalParticipant, useRemoteParticipants, useCamera, ParticipantView } from '@corvidhq/react';

function CallPage({ token, endpoint, roomName }: { token: string; endpoint: string; roomName: string }) {
  return (
    <RavenRoom token={token} endpoint={endpoint} room={roomName} fallback={<p>Connecting…</p>}>
      <Call />
    </RavenRoom>
  );
}

function Call() {
  const state = useConnectionState();
  const local = useLocalParticipant();
  const remote = useRemoteParticipants();
  const camera = useCamera();

  return (
    <div>
      <p>Status: {state}</p>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
        Camera: {camera.enabled ? 'on' : 'off'}
      </button>
      {local && <ParticipantView participant={local} />}
      {remote.map((p) => (
        <ParticipantView key={p.identity} participant={p} />
      ))}
    </div>
  );
}
```

See `examples/react-video-call/` for the full, real, buildable version
(camera/mic/screen-share/device-selection/leave/reconnect status).

## `<RavenRoom>`

The provider every hook needs — also the "RavenRoom" primitive itself.
Owns one `RTCClient`/`Room` for its lifetime.

```tsx
<RavenRoom
  token={token}
  endpoint={endpoint}
  room={roomName}
  iceServers={iceServers}       // optional, from the same token-mint response
  telemetryUrl={telemetryUrl}   // optional, enables Phase 9 telemetry
  autoConnect                    // default true — joins on mount, leaves on unmount
  fallback={<p>Connecting…</p>} // shown while connecting, or on failure
  onError={(error) => {/* RTCError */}}
>
  {children}
</RavenRoom>
```

Set `autoConnect={false}` to control the lifecycle yourself:

```tsx
function ManualJoin() {
  const { join, leave, connectionState } = useRaven();
  return (
    <>
      <button onClick={() => join('room-id')} disabled={connectionState !== 'idle'}>Join</button>
      <button onClick={() => leave()}>Leave</button>
    </>
  );
}
```

`token`/`endpoint`/etc. are read once, at mount — the same one-shot
model `@corvidhq/rtc` itself uses (an RTC token is minted for exactly one
join). To join with a fresh token, remount with a new `key`:
`<RavenRoom key={token} token={token} .../>`.

## Hooks

| Hook | Returns |
|---|---|
| `useRaven()` | The full snapshot (`connectionState`, `room`, `localParticipant`, `remoteParticipants`, `error`, `reconnectCount`) plus `join()`/`leave()`. Prefer the narrower hooks below to avoid rerendering on unrelated changes. |
| `useRoom()` | The current `Room` (or `undefined` before joined). |
| `useConnectionState()` | Just the connection state string. |
| `useLocalParticipant()` | The local participant (or `undefined`). |
| `useRemoteParticipants()` | The current remote participant array. |
| `useParticipants()` | Local participant (if any) followed by every remote one — the full roster. |
| `useRavenError()` | The most recent `RTCError`, if any. |
| `useCamera()` / `useMicrophone()` | `{ enabled, track, enable(), disable(), error }` — synced to real publish state via `localTrackPublished`/`localTrackUnpublished`, not just local component state. |
| `useRavenClient()` | The underlying `RTCClient`, for things with no dedicated hook (device enumeration, `onDeviceChange`) — see below. |

Every hook throws a clear error if used outside `<RavenRoom>`.

### Performance

Each hook subscribes narrowly via `useSyncExternalStore` against an
internal store that only changes the fields a given event actually
affects — a component calling only `useConnectionState()` does not
rerender when `remoteParticipants` changes, and vice versa (Phase 11
spec §30: avoid unnecessary rerenders). This is why there's no single
monolithic "give me everything" hook recommended as the default.

## No UI lock-in

Every hook works with UI you build yourself — nothing requires the
components below. They exist for a fast start, not because you have to
use them.

## Optional components

```tsx
import { RavenVideo, RavenAudio, ParticipantView, LocalParticipantView } from '@corvidhq/react';

<RavenVideo track={someTrack} />          // attaches/detaches a Track to a real <video>
<RavenAudio track={someTrack} />          // same, for <audio>
<ParticipantView participant={participant} />   // video + audio + identity label for one participant
<LocalParticipantView />                         // ParticipantView for whoever is local, via the hook
```

`ParticipantView`/`LocalParticipantView` render whichever camera/screen-
share and microphone tracks a participant currently has — nothing more.
Build your own tile layout with `useParticipants()` + `RavenVideo`/
`RavenAudio` directly if this doesn't fit your design.

## Escape hatch: things without a dedicated hook

Device enumeration/selection and screen sharing don't have dedicated
hooks (the Phase 11 hook wishlist was deliberately kept small) — call
the underlying client/room directly, exactly as you would without
`@corvidhq/react` at all:

```tsx
const client = useRavenClient();
const room = useRoom();

useEffect(() => {
  if (!client) return;
  client.getDevices('videoinput').then(setCameras);
  return client.onDeviceChange(() => client.getDevices('videoinput').then(setCameras));
}, [client]);

<button onClick={() => room?.enableScreenShare()}>Share screen</button>
<select onChange={(e) => room?.setCameraDevice(e.target.value)}>...</select>
```

## Next.js

Every file in this package is marked `'use client'` at the build level,
so Next.js's App Router treats it as a client boundary automatically —
you don't need to add `'use client'` yourself just to import from
`@corvidhq/react`. You still need it in **your own** component file if that
file uses hooks (`useState`, `useConnectionState`, etc.) directly:

```tsx
// app/call/page.tsx — Server Component, no 'use client' needed here
import { CallClient } from './call-client';
export default function Page({ params }: { params: { token: string } }) {
  return <CallClient token={params.token} />;
}
```

```tsx
// app/call/call-client.tsx
'use client';
import { RavenRoom, useConnectionState } from '@corvidhq/react';
export function CallClient({ token }: { token: string }) {
  return <RavenRoom token={token} endpoint="..." room="...">{/* ... */}</RavenRoom>;
}
```

Never render `<RavenRoom>` or call any hook from a Server Component —
`RTCPeerConnection`/`getUserMedia` don't exist during server rendering.

### Strict Mode

React's `<StrictMode>` double-invokes effects in development to surface
cleanup bugs. `<RavenRoom>`'s mount effect calls `join()`; its cleanup
calls `leave()`. Under StrictMode this means: join → leave → join again,
on every mount, in development only. This is a real (if usually harmless)
double-connect — if it's disruptive for your app during development
(e.g. it's confusing to see two `connection_started` telemetry events),
either accept it as a known dev-only artifact, or render your call UI
outside of `<StrictMode>`, as `examples/react-video-call` does (see that
example's `main.tsx` for the reasoning). This does not happen in
production builds, where effects run once.

## TypeScript

Full types are provided, including convenient re-exports of the
`@corvidhq/rtc` types you'll commonly need (`Room`, `Participant`, `Track`,
`RTCError`, `ConnectionState`, `DeviceInfo`, etc.) so most apps don't
need a direct `@corvidhq/rtc` import just for types. Media-plane types are
never exported from either package (Phase 11 spec §27).

## Security

Same model as `@corvidhq/rtc` — `<RavenRoom>` only ever takes the
short-lived RTC token your backend minted (via `@corvidhq/server`/
`raven-sdk`, see `docs/security/server-sdk.md`). It never accepts or
needs a Raven API key, a TURN static credential, or any other permanent
credential.
