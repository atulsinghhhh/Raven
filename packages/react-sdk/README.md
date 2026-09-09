# @ravenkash/react

React hooks and optional UI primitives for [`@ravenkash/rtc`](https://www.npmjs.com/package/@ravenkash/rtc)
and [`@ravenkash/chat`](https://www.npmjs.com/package/@ravenkash/chat).
Headless by default — no UI lock-in.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Install

```bash
npm install @ravenkash/react @ravenkash/rtc
```

`@ravenkash/rtc`, `@ravenkash/chat`, `@ravenkash/client`, `@ravenkash/effects`
and `react` are **peer dependencies**: your app chooses the versions, and
there must be exactly one copy of `@ravenkash/rtc` in the tree.

## Use

```tsx
'use client';
import {
  RavenRoom,
  useConnectionState,
  useCamera,
  useLocalParticipant,
  ParticipantView,
} from '@ravenkash/react';

export function CallPage({ token, endpoint, room }) {
  return (
    <RavenRoom token={token} endpoint={endpoint} room={room} fallback={<p>Connecting…</p>}>
      <Call />
    </RavenRoom>
  );
}

function Call() {
  const state = useConnectionState();
  const camera = useCamera();
  const local = useLocalParticipant();

  return (
    <>
      <p>Status: {state}</p>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
        Toggle camera
      </button>
      {local && <ParticipantView participant={local} />}
    </>
  );
}
```

## Hooks

`useRaven`, `useRavenClient`, `useRoom`, `useConnectionState`,
`useCamera`, `useMicrophone`, `useCameraEffects`, `useLocalParticipant`,
`useRemoteParticipants`, `useParticipants`, `useRavenError`.

The hooks are headless; the components are optional. Build your own UI if
you prefer — nothing forces you through `ParticipantView`.

## Documentation

- [React SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/react.md)
- Runnable example: [`examples/react-video-call`](https://github.com/atulsinghhhh/Raven/tree/main/examples/react-video-call)

## License

MIT
