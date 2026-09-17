# raven_rtc & raven_chat (Flutter)

Livqeno on iOS and Android from Flutter. Two packages, deliberately
separate: a video app never pulls in a message store, and a chat app
never pulls in a WebRTC stack.

```dart
final raven = Raven(token: token, endpoint: endpoint);
final room = await raven.join('room_123');

await room.enableCamera();
await room.enableMicrophone();
```

Same concepts as Livqeno Web and Livqeno React Native. Only the syntax
follows Dart.

## Quickstart

**1. Install**

```yaml
dependencies:
  raven_rtc: ^0.1.8
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

**Never put a Livqeno API key in a mobile app.** An app binary is
downloadable and inspectable.

```
Flutter app
    │  your own authenticated request
    ▼
Your backend  ──(@ravenkash/server or livqeno-sdk)──►  Livqeno
    │                                              │
    │◄──────────── short-lived token ──────────────┘
    ▼
Flutter app  ──────►  Livqeno
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
[flutter_webrtc's screen-capture documentation](https://github.com/flutter-webrtc/flutter-webrtc/blob/main/README.md).

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
in the framework, and Livqeno doesn't require `permission_handler` just for
this. So `request()` genuinely prompts — by asking for the device, which
is what raises the OS dialog — but a pure "what is the status right now"
check isn't possible without a native module, and this package doesn't
pretend to offer one.

If you need pre-flight status, or the denied-vs-permanently-denied
distinction, add `permission_handler` and use it alongside Livqeno:

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

The same service, protocol and guarantees as every other Livqeno Chat
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
- **Verification status of `raven_rtc` 0.1.8.** Every release from 0.1.4
  to 0.1.8 fixed a *timing* defect, not a logic one: a dropped SDP answer
  when the SFU's offer beat `room.joined` (0.1.4), a data channel created
  but never negotiated (0.1.5), a `participantChanges` listener attached
  after `join()` never seeing the initial roster (0.1.6), an
  unconditional `facingMode` on web (0.1.7), and a local self-preview
  that waited for the full offer/answer round trip before notifying
  (0.1.8). All are fixed and pinned by unit tests that drive the real
  `Raven`/`RavenEngine`/`RavenRoom` negotiation and data-channel code
  against a mocked `flutter_webrtc` platform channel.
  Those tests prove the SDK's own logic is correct. They are not a
  substitute for a live run against a real SFU and real
  Android/iOS/browser devices — note that *every one of the bugs above
  was found that way and none of them by unit tests*. Run the matrix —
  publisher and subscriber on each platform you ship, checking that
  `framesDecoded` / `bytesReceived` actually increase, not just that
  signaling completes — before treating RTC as verified for your app.
  **One open defect as of 0.1.8, on Flutter Web:** a remote
  `RavenVideoView` can fail to render a track that arrives *after* the
  tile is first built — engine state (`isCameraEnabled`,
  `remoteParticipants`) is correct while the underlying `<video>` element
  never receives its `srcObject`. In a two-party call this affects
  whoever joined and published first. Root cause is not yet pinned and
  no fix has shipped.
- **Verification status of `raven_live`.** Genuinely end-to-end
  verified once, not merely unit-tested: a real Flutter *Web* build
  (Chrome, fake camera device) publishing to a real local backend and
  SFU, with a real browser subscriber confirming actual frame/byte
  growth, and the reverse direction (real browser host, Flutter Web
  viewer). See `apps/api/test/flutter-live-streaming.e2e-spec.ts` and
  `flutter_check/live_host`. Not yet verified: a native iOS/Android
  build (this repo has no device/simulator with camera access to test
  against), and Flutter-host-to-Flutter-viewer specifically. Re-run
  before depending on either.

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

**App crashes outright on Android the instant `join()` reaches WebRTC**
(`SIGABRT` in `network_thread`, backtrace entirely inside
`libjingle_peerconnection_so.so`, `Check failed: false` at
`jvm.cc:81`). This is inside `flutter_webrtc`'s bundled native WebRTC
binary — `raven_rtc` ships no native code or Android build config of its
own (see Architecture, below), so there is nothing to patch here.
`flutter_webrtc` doesn't build the native WebRTC code itself either: it
pulls a prebuilt third-party AAR, `io.github.webrtc-sdk:android:150.7871.01`
(Google stopped publishing official WebRTC AARs), so the native binary's
own compatibility is entirely out of this repo's — and flutter_webrtc's
own build config's — control. `flutter_webrtc` is already pinned to its
newest release (`1.6.2+hotfix.3`) and already carries the `compileSdk 36`
bump for 16KB-page-size support (upstream
[flutter-webrtc/flutter-webrtc#1932](https://github.com/flutter-webrtc/flutter-webrtc/issues/1932)),
but that's the plugin's own compile target, not a relink of the prebuilt
`.so`. Given the device this was first seen on was an **unreleased
Android API 37.1 preview** — with `raven_chat` (no WebRTC) working fine
on the same device — the more likely explanation is that prebuilt binary
predating a not-yet-released Android version, not a general regression.
Reproduce on a mainstream (non-preview) Android image/device before
treating this as broken on real hardware.

**Local self-preview stayed on the placeholder while the remote peer's
video rendered fine (fixed in 0.1.8).** `enableCamera()`/
`enableMicrophone()`/`enableScreenShare()` only notified listeners about
a newly published local track after the full SFU offer/answer round
trip finished, even though the local `MediaStream` was already captured
and ready to render much earlier. A remote track has no equivalent
avoidable delay, so the local tile visibly lagged behind — most
noticeable on Flutter Web under a headless Chromium harness. `raven_rtc`
now notifies as soon as the local track is captured. If you still see a
stuck local preview on 0.1.8+, that's a new, different issue — file it
with a repro.

## Architecture

```
raven_rtc                        raven_chat
    │                                │
    ├── flutter_webrtc              └── web_socket_channel + http
    └── web_socket_channel                   │
            │                        Livqeno Chat service
    native iOS/Android WebRTC
```

`raven_rtc` ships no native code of its own — the iOS and Android WebRTC
implementation arrives through `flutter_webrtc`, exactly as
`@ravenkash/rtc` gets it from the browser on the web. A second native layer
would mean two implementations competing for the same camera.

What `raven_rtc` *does* own, and previously did not, is the signaling
protocol and the peer-connection lifecycle (`lib/src/internal/`). Those
used to come from a third-party client; they are Livqeno's own now, which is
what lets the SFU change without a package release.

`raven_chat` is pure Dart over the platform's own networking.
