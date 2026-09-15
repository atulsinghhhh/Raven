# React video-call example — `@ravenkash/react`

A real, buildable React app (Vite + TypeScript) demonstrating the Phase
11 SDK — join a room, camera/microphone, screen sharing, device
selection, remote participant tiles, connection status, and leave — all
through `@ravenkash/react`'s hooks and `<RavenRoom>`/`<ParticipantView>`. No
media-plane types appear anywhere in `src/`.

This is a sibling to `examples/video-call/` (the original no-build-step,
plain-JS `@ravenkash/rtc` demo, kept exactly as-is) — this one shows the same
underlying SDK from the React/hooks side.

## Running it

Sign up for a Raven Cloud project at the
[dashboard](https://app.ravenstack.online) and create an API key from the
project's API Keys tab.

```bash
cd examples/react-video-call
npm install   # installs @ravenkash/rtc and @ravenkash/react from npm
npm run dev   # → http://localhost:8901
```

Mint a real RTC token against `https://api.ravenstack.online` (e.g.
`raven rooms create` + a direct `POST /v1/rooms/:roomId/rtc-tokens` with
your API key as a bearer token), paste the full JSON response into the
textarea, and click **Join Room**. Open a second tab with a different
`participantIdentity` in the same room to see two-way video.

## What this proves

- `<RavenRoom>` (the provider) + `useConnectionState()`/
  `useLocalParticipant()`/`useRemoteParticipants()`/`useCamera()`/
  `useMicrophone()` are enough to build a real call UI — no direct
  `@ravenkash/rtc` `Room` juggling required.
- `<ParticipantView>` renders a participant's video/audio tracks and
  identity label without the app touching `Track.attach()` itself.
- Device enumeration + `onDeviceChange()` (via `useRavenClient()`,
  demonstrating the "escape hatch" to the lower-level client) and
  `room.enableScreenShare()` work through the headless hooks/room access
  just as well as a dedicated hook would — you are never locked into
  only what this package's hooks happen to wrap.

## Strict Mode

`main.tsx` deliberately does not wrap `<App>` in `<StrictMode>` — see the
comment there and `docs/sdk/react.md#strict-mode` for why (StrictMode's
dev-only double-invoke of effects would join → leave → rejoin the same
room on every mount, which is more confusing than useful in a demo whose
entire point is to show one clean connection lifecycle).
