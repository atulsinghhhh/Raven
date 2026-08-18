# Raven Flutter example — video call with chat

A real Raven call in Flutter: WebRTC media through Raven's SFU, messages
through Raven Chat into Postgres. No mocks anywhere.

## Running it

Needs the Raven stack up (`pnpm infra:up` from the repo root) and a
project API key.

```bash
cd examples/flutter-rtc-chat

# Terminal 1 — backend that holds RAVEN_API_KEY and mints both tokens
npm install
RAVEN_API_KEY=rvk_xxx.yyy npm run server

# Terminal 2
flutter pub get
flutter run --dart-define=RAVEN_BACKEND_URL=http://<your-lan-ip>:8791
```

**On a real device, `localhost` means the phone.** Pass your machine's
LAN IP via `--dart-define`, and make sure the returned `livekitUrl` is
reachable from the device too.

Android needs `minSdkVersion 23`; iOS needs deployment target 13.0+ and
the camera/microphone usage strings in `Info.plist`. Video does not work
in simulators — they have no camera.

## What it demonstrates

Remote video, a local preview, camera/mic toggles, front-rear camera
switch, a chat panel with history and typing indicators, and leaving
cleanly.

## Worth noticing in the code

`ListenableBuilder(listenable: room, …)` — `RavenRoom` is a
`ChangeNotifier`, so the widget tree rebuilds from it directly. That's
the idiomatic-Dart divergence from the TypeScript SDK: identical
concepts, platform-appropriate subscription. Typed streams
(`room.participantChanges`, `chat.messages`) are there for logic outside
the widget tree.

See [docs/sdk/flutter.md](../../docs/sdk/flutter.md).
