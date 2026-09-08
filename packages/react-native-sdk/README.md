# @ravenkash/react-native

Raven for React Native — real-time video, voice and messaging on iOS and
Android, with the same API as Raven Web.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

Reuses [`@ravenkash/rtc`](https://www.npmjs.com/package/@ravenkash/rtc)
unmodified: the protocol, reconnection and track handling are the same
code that runs in the browser, not a parallel implementation that drifts.

## Install

```bash
npm install @ravenkash/react-native @ravenkash/rtc @ravenkash/chat @ravenkash/effects
npm install react-native-webrtc react-native-incall-manager
```

Peer dependencies — your app chooses the versions:
`react >= 18`, `react-native >= 0.73`, `react-native-webrtc >= 124`,
`react-native-incall-manager >= 4.2`.

Camera and microphone permissions must be declared in `Info.plist` and
`AndroidManifest.xml`; see the reference below.

## Use

```tsx
import { Raven, RavenVideoView } from '@ravenkash/react-native';

const raven = new Raven({ token, endpoint, iceServers });

const room = await raven.join(roomId);
await room.enableCamera();
await room.enableMicrophone();
```

```tsx
<RavenVideoView participant={participant} style={{ flex: 1 }} />
```

### Live streaming

```tsx
import { joinLiveStream } from '@ravenkash/react-native';

const stream = await joinLiveStream(credentials);
```

## Exports

`Raven`, `RavenVideoView`, `RavenLiveStream`, `joinLiveStream`, and the
`RavenConfig`, `RavenChatHandle`, `RavenAppState`, `LiveStreamCredentials`,
`LiveStreamRole` types.

## Documentation

- [React Native SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/react-native.md)
- Runnable example: [`examples/mobile-rtc-chat`](https://github.com/atulsinghhhh/Raven/tree/main/examples/mobile-rtc-chat)

Flutter? See [`raven_rtc`](https://github.com/atulsinghhhh/Raven/tree/main/sdks/flutter/raven_rtc).

## License

MIT
