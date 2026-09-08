# @corvidhq/react

React hooks and optional UI primitives for [`@corvidhq/rtc`](https://www.npmjs.com/package/@corvidhq/rtc)
and [`@corvidhq/chat`](https://www.npmjs.com/package/@corvidhq/chat).
Headless by default — no UI lock-in.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Install

```bash
npm install @corvidhq/react @corvidhq/rtc
```

`@corvidhq/rtc`, `@corvidhq/chat`, `@corvidhq/client`, `@corvidhq/effects`
and `react` are **peer dependencies**: your app chooses the versions, and
there must be exactly one copy of `@corvidhq/rtc` in the tree.

## Use

```tsx
'use client';
import {
  RavenRoom,
  useConnectionState,
  useCamera,
  useLocalParticipant,
  ParticipantView,
} from '@corvidhq/react';

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
