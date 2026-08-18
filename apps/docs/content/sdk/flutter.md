---
title: Flutter SDK
description: raven_rtc and raven_chat — idiomatic Dart, identical concepts to Raven Web.
---

Two packages, deliberately separate: a video app never pulls in a
message store, and a chat app never pulls in a WebRTC stack.

```dart
final raven = Raven(token: token, endpoint: endpoint);
final room = await raven.join('room_123');

await room.enableCamera();
await room.enableMicrophone();
```

Same concepts as Raven Web and React Native. Only the syntax follows
Dart.

## Install

Not on pub.dev yet — install directly from the repository as a git
dependency, pointing `path:` at the package's subdirectory:

```yaml
dependencies:
  raven_rtc:
    git:
      url: https://github.com/atulsinghhhh/Raven.git
      path: sdks/flutter/raven_rtc
  raven_chat:                    # only if you want messaging
    git:
      url: https://github.com/atulsinghhhh/Raven.git
      path: sdks/flutter/raven_chat
```

Pin to a commit or tag once you've picked a version to build against
(`ref: v0.1.0`), so `flutter pub get` doesn't silently pull a newer
commit on a fresh checkout.

**Permissions** — the SDK can't add these for you.

`ios/Runner/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Camera access is used for video calls.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Microphone access is used for calls.</string>
```

`android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

Also set `minSdkVersion 23` in `android/app/build.gradle` (WebRTC won't
build below it) and an iOS deployment target of 13.0 or later.

## Idiomatic Dart, identical concepts

`RavenRoom` and `RavenChat` both extend `ChangeNotifier` and expose typed
streams — the one place this SDK deliberately diverges from the
TypeScript one. `room.on('event', handler)` would work in Dart but would
feel foreign.

```dart
// In the widget tree
ListenableBuilder(listenable: room, builder: (context, _) => ...)

// Outside it
room.connectionStateChanges.listen((state) => ...);
room.participantChanges.listen((participants) => ...);
chat.messages.listen((message) => ...);
```

## Camera, microphone, screen share

```dart
await room.enableCamera();
await room.disableCamera();
await room.enableMicrophone();
await room.disableMicrophone();
await room.switchCamera();          // front <-> rear
await room.enableScreenShare();
```

`switchCamera()` has no web equivalent — a phone-specific concern common
enough to deserve its own method rather than device enumeration.

Screen sharing works out of the box on Android. **iOS needs a Broadcast
Upload Extension** — a target you add in Xcode, not something a package
can provide. Without it, `enableScreenShare()` throws.

## Rendering video

```dart
RavenVideoView(
  participant: participant,
  room: room,                     // enables automatic updates
  kind: RavenTrackKind.camera,
  fit: RavenVideoFit.cover,
  placeholder: const ColoredBox(color: Colors.black),
)
```

Pass `room` and the widget follows track changes by itself, and disposes
its native texture with the widget — dropping that is how a scrolling
grid leaks a native view per rebuild.

## Permissions

```dart
final granted = await RavenPermissions.request();
// { RavenPermission.camera: true, RavenPermission.microphone: false }

await RavenPermissions.require(); // throws RavenPermissionException
```

Flutter has no permissions API in the framework, and this package
doesn't require `permission_handler` just for this — `request()`
genuinely prompts (asking for the device is what raises the OS dialog),
but a pure "what's the status right now" check isn't possible without a
native module. If you need pre-flight status, or the
denied-vs-permanently-denied distinction, add `permission_handler`
alongside Raven:

```dart
final status = await Permission.camera.status;
if (status.isPermanentlyDenied) {
  await openAppSettings();
} else {
  await RavenPermissions.require([RavenPermission.camera]);
}
```

## Chat

```dart
final chat = RavenChat(token: chatToken, apiUrl: apiUrl);
await chat.connect('room_123');

chat.messages.listen((message) => print('${message.senderId}: ${message.text}'));
await chat.send('Hello everyone!');
```

The same service, protocol, and guarantees as every other Raven Chat
client:

```dart
final page = await chat.history(limit: 50);
await chat.edit(messageId, 'Updated');
await chat.delete(messageId);
await chat.addReaction(messageId, '👍');
await chat.markAsRead(messageId);
await chat.startTyping();

final thread = await chat.thread(messageId);
final present = await chat.getPresence();
```

Streams: `messages`, `messageUpdates`, `messageDeletions`, `typing`,
`presence`, `reactions`, `readReceipts`, `connectionStateChanges`,
`errors`. `send()` completes only once the message is durably stored and
attaches an idempotency key automatically. See
[Chat Overview](/chat/overview).

## Reconnection

Handled for you with bounded exponential backoff and jitter — `RavenChat`
re-joins its rooms on the new socket and stops after a maximum number of
attempts rather than looping forever. A rejected token is never retried
— close codes 4401 and 4403 are terminal.

## Production

- **Screen share on iOS** needs the Broadcast Upload Extension target —
  see [LiveKit's iOS screen-share guide](https://docs.livekit.io/home/client/tracks/screenshare/).
- **`minSdkVersion 23`** and **iOS 13+** are hard floors, not
  suggestions — WebRTC won't build below them.
