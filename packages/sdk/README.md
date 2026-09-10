# @ravenkash/rtc

Raven's browser RTC SDK — join a room, publish camera and microphone,
subscribe to remote media. Hides SDP, ICE, STUN, TURN and the media server
behind a small typed API.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Install

```bash
npm install @ravenkash/rtc
```

## Use

The token and endpoint come from your own backend — never mint them in a
browser. See [`@ravenkash/server`](https://www.npmjs.com/package/@ravenkash/server)
or [Raven's Python SDK](https://github.com/atulsinghhhh/Raven/tree/main/sdks/python) for Python (not on PyPI yet — the
`raven-sdk` name there belongs to an unrelated project).

```ts
import { createRTCClient } from '@ravenkash/rtc';

// `grant` is your backend's RTC token-mint response, forwarded verbatim.
// It already carries the endpoint, the ICE servers and the room, so there
// is nothing here to configure and no URL to hand-build.
const client = createRTCClient(grant);
const room = await client.join();

// Spelling out the same thing, if you prefer to be explicit:
//   const client = createRTCClient({
//     token: grant.token,
//     endpoint: grant.endpoint,       // Raven's signaling WebSocket
//     iceServers: grant.iceServers,   // never hand-build STUN/TURN config
//   });
//   const room = await client.join(grant.roomName);

await room.enableCamera();
await room.enableMicrophone();

room.on('trackSubscribed', (track) => {
  document.body.appendChild(track.attach());
});
```

`join()` resolves once the **control plane** admits you. You can publish
immediately, but ICE and DTLS finish a moment later — render from the
`connected` event rather than assuming:

```ts
room.on('connected', () => setStatus('live'));
// or, if you must block: await room.waitUntilConnected();
```

## Exports

`createRTCClient`, `RTCClient`, `Room`, `Participant`,
`LocalParticipant`, `RemoteParticipant`, `Track`, `LocalTrack`,
`RemoteTrack`, `RTCError`, `isRTCError`.

## Documentation

- [Browser SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk.md)
- [RTC architecture](https://github.com/atulsinghhhh/Raven/blob/main/docs/rtc/architecture.md)
- [Signaling protocol](https://github.com/atulsinghhhh/Raven/blob/main/docs/rtc/signaling.md)
- [What is and is not tested](https://github.com/atulsinghhhh/Raven/blob/main/docs/rtc/test-matrix.md)
- Runnable examples: [`video-call`](https://github.com/atulsinghhhh/Raven/tree/main/examples/video-call)

## React?

Use [`@ravenkash/react`](https://www.npmjs.com/package/@ravenkash/react) —
headless hooks over this package, with optional components.

## License

MIT
