# raven_rtc & raven_chat (Flutter)

Raven on iOS and Android from Flutter. Two packages, deliberately
separate: a video app never pulls in a message store, and a chat app
never pulls in a WebRTC stack.

```dart
final raven = Raven(token: token, endpoint: endpoint);
final room = await raven.join('room_123');

await room.enableCamera();
await room.enableMicrophone();
```

Same concepts as Raven Web and Raven React Native. Only the syntax
follows Dart.

## Quickstart

**1. Install**

```yaml
dependencies:
  raven_rtc: ^0.1.0
  raven_chat: ^0.1.0   # only if you want messaging
```

**2. Permissions** — the SDK can't add these for you.

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

Also set `minSdkVersion 23` in `android/app/build.gradle` — WebRTC won't
build below it — and iOS deployment target 13.0 or later.

Missing an iOS usage string doesn't produce an error; it **crashes the
app** the instant it asks.

**3. Join and render**

```dart
class CallScreen extends StatefulWidget { /* … */ }

class _CallScreenState extends State<CallScreen> {
  Raven? _raven;
  RavenRoom? _room;

  @override
  void initState() {
    super.initState();
    _connect();
  }

  Future<void> _connect() async {
    await RavenPermissions.request();

    final raven = Raven(token: widget.token, endpoint: widget.endpoint);
    final room = await raven.join('room_123');

    if (!mounted) {
      await raven.leave();
      return;
    }
    setState(() { _raven = raven; _room = room; });
  }

  @override
  void dispose() {
    _raven?.leave();
    _room?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final room = _room;
    if (room == null) return const CircularProgressIndicator();

    return ListenableBuilder(
      listenable: room,
      builder: (context, _) => RavenVideoView(
        participant: room.remoteParticipants.firstOrNull,
        room: room,
      ),
    );
  }
}
```

## Authentication

**Never put a Raven API key in a mobile app.** An app binary is
downloadable and inspectable.

```
Flutter app
    │  your own authenticated request
    ▼
Your backend  ──(@raven/server or raven-sdk)──►  Raven
    │                                              │
    │◄──────────── short-lived token ──────────────┘
    ▼
Flutter app  ──────►  Raven
```

Your backend decides the participant identity from *its own* session,
never from a value the app sent.

## Idiomatic Dart, identical concepts

`RavenRoom` and `RavenChat` both extend `ChangeNotifier` and also expose
typed streams. That's the one place the Flutter SDK deliberately diverges
from the TypeScript one: `room.on('event', handler)` would work in Dart
but would feel foreign, and the spec asks for idiomatic Dart rather than
a transliteration.

Use whichever fits:

```dart
// In the widget tree
ListenableBuilder(listenable: room, builder: (context, _) => …)

// Outside it
room.connectionStateChanges.listen((state) => …);
room.participantChanges.listen((participants) => …);
chat.messages.listen((message) => …);
```

## Camera, microphone, screen share

```dart
await room.enableCamera();
await room.disableCamera();
await room.enableMicrophone();
await room.disableMicrophone();
await room.switchCamera();          // front ↔ rear
await room.enableScreenShare();
```

`switchCamera()` has no web equivalent — it's a phone concern, and common
enough to deserve a method rather than device enumeration.

### Screen sharing

Android works out of the box (the system shows a consent dialog).

**iOS needs a Broadcast Upload Extension** in your app — a target you add
in Xcode, not something a package can provide. Without it,
`enableScreenShare()` throws. See
[livekit_client's iOS screen-share guide](https://docs.livekit.io/home/client/tracks/screenshare/).

## Rendering video

```dart
RavenVideoView(
  participant: participant,
  room: room,                     // enables automatic updates
  kind: RavenTrackKind.camera,
  fit: RavenVideoFit.cover,
  mirror: null,                   // defaults: true for local camera
  placeholder: const ColoredBox(color: Colors.black),
)
```

Pass `room` and the widget follows track changes by itself. It disposes
its native texture with the widget — dropping that is how a scrolling
grid leaks a native view per rebuild.

## Permissions

```dart
final granted = await RavenPermissions.request();
// { RavenPermission.camera: true, RavenPermission.microphone: false }

await RavenPermissions.require();   // throws RavenPermissionException
```

**A limitation worth stating up front:** Flutter has no permissions API
in the framework, and Raven doesn't require `permission_handler` just for
this. So `request()` genuinely prompts — by asking for the device, which
is what raises the OS dialog — but a pure "what is the status right now"
check isn't possible without a native module, and this package doesn't
pretend to offer one.

If you need pre-flight status, or the denied-vs-permanently-denied
distinction, add `permission_handler` and use it alongside Raven:

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

The same service, protocol and guarantees as every other Raven Chat
client:

```dart
final page = await chat.history(limit: 50);
final older = await chat.history(before: page.nextCursor);

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
`errors`.

`send()` completes only once the message is durably stored, and attaches
an idempotency key automatically — a retry after a reconnect returns the
original message instead of posting a duplicate. See
[../chat/overview.md](../chat/overview.md).

## Reconnection

Handled for you, with bounded exponential backoff and jitter. `RavenChat`
re-joins its rooms on the new socket and stops after
`maxReconnectAttempts` rather than looping forever. It does not retry a
rejected token — close codes 4401 and 4403 are terminal.

After a reconnect, refetch what you missed. The socket is never the
source of truth:

```dart
chat.connectionStateChanges.listen((state) async {
  if (state == RavenChatConnectionState.connected && _newest != null) {
    final missed = await chat.history(after: _newestCursor);
    // …
  }
});
```

## Lifecycle

Flutter surfaces app lifecycle through `WidgetsBindingObserver`, and the
SDK deliberately doesn't take that over — a package that silently
disconnects on background would remove a product decision from you.

```dart
class _CallScreenState extends State<CallScreen> with WidgetsBindingObserver {
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.detached) {
      _raven?.leave();
    }
  }
}
```

Video capture stops when backgrounded (the OS suspends the camera) and
resumes on return. Audio continues if you've enabled background audio.

Always release in `dispose()`:

```dart
@override
void dispose() {
  _raven?.leave();
  _room?.dispose();
  _chat?.dispose();
  super.dispose();
}
```

## Error handling

```dart
try {
  await room.enableCamera();
} on RavenPermissionException catch (error) {
  error.permanentlyDenied ? openSettings() : promptAgain();
} on RavenException catch (error) {
  print(error.code);        // RavenErrorCode.mediaError, …
}
```

Chat errors are `RavenChatException`, with `isRetryable` to distinguish a
transient failure from one that will fail identically forever. An
unrecognised server code becomes `RavenChatErrorCode.unknown` with the
original string on `rawCode` — a newer server widens the model rather
than breaking your app.

Codes match the web SDK's: [../error-codes.md](../error-codes.md).

## Performance

`raven_rtc` enables **adaptive streaming** and **dynacast** by default,
which the web SDK leaves off. On a phone, decoding a 1080p stream into a
thumbnail is a direct cost in battery, CPU and mobile data; adaptive
streaming asks for only the resolution a view is actually showing. It
works because `RavenVideoView` reports its size to the renderer.

Turn them off if you need identical behaviour to web:

```dart
Raven(token: token, endpoint: endpoint, adaptiveStream: false, dynacast: false);
```

## Production

- **Background audio (iOS):** add the `audio` background mode, or calls
  end when the app is backgrounded.
- **Simulators can't capture video.** Test on real hardware.
- **`minSdkVersion 23`** on Android; WebRTC won't build below it.
- **Use `wss://` and `https://`.** Android blocks cleartext by default.

## Troubleshooting

**Black video, no error.** Permissions. Call `RavenPermissions.request()`
and check the result.

**Build fails on Android with a minSdkVersion error.** Raise it to 23.

**`enableScreenShare()` throws on iOS.** You need a Broadcast Upload
Extension — see above.

**Works on Wi-Fi, fails on cellular.** Carrier NAT needs TURN. Forward
the `iceServers` from your token response.

**Video freezes on reconnect.** Pass `room` to `RavenVideoView` so it
follows track changes.

## Architecture

```
raven_rtc                        raven_chat
    │                                │
    └── livekit_client               └── web_socket_channel + http
            │                                │
    native iOS/Android WebRTC        Raven Chat service
```

`raven_rtc` ships no native code of its own — the iOS and Android WebRTC
implementation arrives through `livekit_client`, exactly as `@raven/rtc`
gets it from `livekit-client` on the web. A second native layer would
mean two implementations competing for the same camera.

`raven_chat` is pure Dart over the platform's own networking.
