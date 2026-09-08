# raven_rtc

Raven's Flutter SDK — join a room, publish camera and microphone, render
participants. Hides WebRTC, SDP, ICE, STUN, TURN and the media server
behind a small typed API.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Requirements

- Dart SDK **>= 3.6.0**
- Flutter **>= 3.27.0**

## Install

```yaml
dependencies:
  raven_rtc: ^0.1.0
```

Camera and microphone permissions must be declared in `Info.plist` and
`AndroidManifest.xml` — see the reference below.

## Use

The token comes from your own backend, never from the app. See the
[TypeScript](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/server/typescript.md) or
[Python](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/server/python.md) server SDK.

```dart
import 'package:raven_rtc/raven_rtc.dart';

final raven = Raven(
  token: grant.token,
  endpoint: grant.endpoint,
  iceServers: grant.iceServers,
);

final room = await raven.join(roomId);

await room.enableCamera();
await room.enableMicrophone();
```

Render a participant:

```dart
RavenVideoView(participant: participant)
```

`RavenRoom` is a `ChangeNotifier`, so `ListenableBuilder` and
`AnimatedBuilder` work as you would expect.

## Documentation

- [Flutter SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/flutter.md)
- [RTC architecture](https://github.com/atulsinghhhh/Raven/blob/main/docs/rtc/architecture.md)
- Runnable example: [`examples/flutter-rtc-chat`](https://github.com/atulsinghhhh/Raven/tree/main/examples/flutter-rtc-chat)

Messaging is a separate package —
[`raven_chat`](https://pub.dev/packages/raven_chat) — so a video app never
carries a message store.

## License

MIT
