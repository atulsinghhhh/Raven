# raven_chat

Livqeno Chat for Flutter — real-time messaging with durable history,
presence, typing indicators, reactions, read receipts and threads.
Connect, send and listen without writing WebSocket code.

Part of [Livqeno](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Requirements

- Dart SDK **>= 3.6.0**
- Flutter **>= 3.27.0**

## Install

```yaml
dependencies:
  raven_chat: ^0.1.0
```

## Use

The chat token is minted by your backend and is a separate credential from
an RTC token — neither works on the other plane.

```dart
import 'package:raven_chat/raven_chat.dart';

final chat = RavenChat(token: grant.token, apiUrl: grant.apiUrl);

await chat.connect('room_123');

chat.messages.listen((message) => setState(() => _messages.add(message)));

await chat.send('Hello everyone!');
```

`RavenChat` extends `ChangeNotifier`, so a widget can rebuild from it
directly, with typed streams (`messages`, `typing`, `presence`,
`reactions`, `readReceipts`, `connectionStateChanges`, `errors`) for logic
outside the widget tree.

Postgres is the source of truth: a message is reported sent only once it is
durably stored, a retried send never duplicates, and a client that was
offline catches up from history rather than the socket.

## Independent of raven_rtc

WebSocket and HTTP only — no WebRTC. A messaging app never pulls in a
media stack, and a video app never pulls in a message store. Use both
together for a call with a chat panel.

## Documentation

- [Flutter SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/flutter.md)
- [Chat overview](https://github.com/atulsinghhhh/Raven/blob/main/docs/chat/overview.md)
- Runnable example: [`examples/flutter-rtc-chat`](https://github.com/atulsinghhhh/Raven/tree/main/examples/flutter-rtc-chat)

## License

MIT
