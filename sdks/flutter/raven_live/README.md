# raven_live

Raven Live Streaming for Flutter — join a stream as a host, co-host or
viewer, with the room and the live chat that come with it.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

Composes [`raven_rtc`](https://pub.dev/packages/raven_rtc) and
[`raven_chat`](https://pub.dev/packages/raven_chat); it adds no media or
messaging stack of its own. `stream.room` is an ordinary `RavenRoom` and
`stream.chat` is an ordinary `RavenChat`, so every API on both packages
works here unchanged.

## Requirements

- Dart SDK **>= 3.6.0**
- Flutter **>= 3.27.0**

## Install

```yaml
dependencies:
  raven_live: ^0.1.0
```

## Use

Host, co-host and viewer credentials are minted per stream, per role, by
your backend.

```dart
import 'package:raven_live/raven_live.dart';

final stream = await RavenLiveStream.join(credentials);

if (stream.isHost) {
  await stream.room.enableCamera();
  await stream.room.enableMicrophone();
}
```

## Documentation

- [Flutter SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/flutter.md)
- Runnable example: [`examples/flutter-rtc-chat`](https://github.com/atulsinghhhh/Raven/tree/main/examples/flutter-rtc-chat)

## License

MIT
