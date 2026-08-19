# @corvidhq/react-native

Raven on iOS and Android, with the same API as Raven Web.

```tsx
import { Raven, RavenVideoView } from '@corvidhq/react-native';

const raven = new Raven({ token, endpoint });
const room = await raven.join('room_123');

await room.enableCamera();
await room.enableMicrophone();
```

If that looks like the web SDK, that's the point — and it isn't a
resemblance. The `Room` you get back is the *same class* `@corvidhq/rtc`
returns in a browser. Everything you know about rooms, participants,
tracks and events is true here.

## Quickstart

**1. Install**

```bash
npm install @corvidhq/react-native @corvidhq/rtc @corvidhq/chat \
            @livekit/react-native @livekit/react-native-webrtc

cd ios && pod install   # iOS only
```

**2. Permissions** — the SDK can't add these for you.

`ios/YourApp/Info.plist`:

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

Missing an iOS usage string doesn't produce an error — it **crashes the
app** the instant it asks, which surfaces as an App Store review failure
rather than a bug report.

**3. Get a token from your backend, join, render.**

```tsx
function Call({ session }) {
  const [room, setRoom] = useState();

  useEffect(() => {
    const raven = new Raven({ token: session.token, endpoint: session.livekitUrl });
    raven.join('room_123').then(setRoom);
    return () => void raven.dispose();
  }, [session]);

  const remotes = useRemoteParticipants(room);

  return (
    <RavenVideoView participant={remotes[0]} room={room} style={{ flex: 1 }} />
  );
}
```

That's the whole integration. No `registerGlobals()`, no audio session,
no reconnect logic.

## Authentication

**Never put a Raven API key in a mobile app.** An app binary is
downloadable and inspectable; anything inside it is public.

```
Mobile app
    │  your own authenticated request
    ▼
Your backend  ──(@corvidhq/server, API key)──►  Raven
    │                                          │
    │◄────────── short-lived token ────────────┘
    ▼
Mobile app  ──────►  Raven
```

Your backend decides the participant identity from *its own* session —
never from a value the app sent. See
[../security/server-sdk.md](../security/server-sdk.md).

## Initialising

RTC and chat are independent, and so are their credentials. Supply
whichever planes your app actually uses:

```ts
// A video call, with or without chat
new Raven({ token, endpoint });
new Raven({ token, endpoint, chatToken, chatApiUrl });

// Messaging only — no RTC connection is ever created
new Raven({ chatToken, chatApiUrl });
```

`raven.hasRtc` tells you which you got, which is what a shared component
needs to decide whether to render call controls. Calling `join()` on a
messaging-only instance throws immediately with an error that says so,
rather than failing later as a connection problem.

Passing `token` without `endpoint` (or vice versa) throws at construction
— that combination is always a mistake, and catching it here beats
catching it as a network error at join time.

```ts
const raven = new Raven({
  token,                   // RTC token from your backend — omit for chat-only
  endpoint,                // livekitUrl from the same response
  iceServers,              // forward as-is
  telemetryUrl,
  chatToken,               // optional — omit for an RTC-only app
  chatApiUrl,
  logLevel: 'info',
  manageAudioSession: true,
  onAppStateChange: (state) => {},
  onNetworkReconnect: () => {},
  onChatTokenExpiring: async () => (await refresh()).token,
});
```

Constructing a `Raven` registers the WebRTC globals. If you need them
earlier — a camera preview on a pre-join screen — call
`bootstrapRavenNative()` in your `index.js`.

## Joining

```ts
const room = await raven.join('room_123');
const room = await raven.join('room_123', { requestPermissions: false });

await raven.leave();      // leaves the room, keeps chat connected
await raven.dispose();    // tears down everything, including chat
```

`join()` requests camera and microphone permission by default, because
discovering a refused camera *mid-call* is worse than being asked up
front. A refusal doesn't block joining — a user who declined the camera
can still watch and listen.

## Camera and microphone

```ts
await room.enableCamera();
await room.disableCamera();
await room.enableMicrophone();
await room.disableMicrophone();
```

Or as a hook, with the state a button actually needs:

```tsx
const camera = useCamera(room);

<Pressable onPress={() => camera.toggle()} disabled={camera.busy}>
  <Text>{camera.enabled ? 'Camera off' : 'Camera on'}</Text>
</Pressable>
```

`busy` matters more here than on web: acquiring a camera takes a
noticeable moment on a phone, and without it users double-tap and toggle
twice.

## Rendering video

```tsx
<RavenVideoView participant={remote} room={room} style={{ flex: 1 }} />
<RavenVideoView participant={room.localParticipant} room={room} style={pip} zOrder={1} />
```

Pass `room` and the view follows track changes — published, unpublished,
muted, resubscribed — by itself. Without it, it renders once and stays
put, which suits a static thumbnail and breaks a call.

| Prop | Purpose |
| --- | --- |
| `participant` | Whose video. Local or remote |
| `room` | Enables automatic updates |
| `source` | `'camera'` (default) or `'screenShare'` |
| `objectFit` | `'cover'` (default) or `'contain'` |
| `mirror` | Defaults to true for the local camera |
| `zOrder` | `1` puts a local preview above remote video on Android |
| `placeholder` | Shown when there's no video |

## Permissions

```ts
import { permissions } from '@corvidhq/react-native';

const status = await permissions.request();     // { camera, microphone }
await permissions.require(['camera']);          // throws on refusal
```

Statuses: `granted`, `denied`, `blocked`, `undetermined`, `unavailable`.

`blocked` is the one that changes your UI — re-prompting does nothing and
only the Settings app will help:

```ts
try {
  await permissions.require();
} catch (error) {
  if (error.requiresSettings) {
    showSettingsPrompt();
  }
}
```

**Platform difference, stated plainly.** Android has a real permissions
API, so `check()` reports actual state without prompting. iOS exposes no
such API to JavaScript without a native module, so `check()` returns
`undetermined` there rather than guessing, and `request()` does the real
work by asking for the device.

## Chat

Present as `raven.chat` when you passed a `chatToken`. A messaging-only
app needs nothing else:

```ts
const raven = new Raven({ chatToken: session.token, chatApiUrl: session.apiUrl });

await raven.chat!.connect('room_123');
await raven.chat!.send('Hello everyone!');
```

Alongside a call, it's the same object on the same instance:

```ts
await raven.chat.connect('room_123');
await raven.chat.send('Hello everyone!');

const unsubscribe = raven.chat.on('message', (message) => {
  console.log(`${message.senderId}: ${message.text}`);
});
```

Everything else is `@corvidhq/chat`'s API unchanged — `messages.list()`,
`startTyping()`, `markAsRead()`, `messages.addReaction()`, presence,
threads. It *is* the same client, so
[the chat documentation](../chat/overview.md) applies verbatim.

Chat and RTC are independent connections. Either can fail without the
other noticing.

## Reconnection

Handled for you. The SDK reconnects with bounded exponential backoff and
jitter, re-joins rooms, and gives up rather than looping forever.

What mobile adds over web is connectivity awareness. Install
`@react-native-community/netinfo` (optional) and a Wi-Fi → cellular
handover triggers a fast reconnect instead of waiting out an ICE timeout:

```bash
npm install @react-native-community/netinfo
```

Without it everything still works; recovery is just slower.

## Lifecycle

The SDK watches `AppState` and reports transitions via
`onAppStateChange`. It deliberately **does not disconnect on
background** — on both platforms a backgrounded app with an active audio
session keeps running, and dropping the socket would turn "switched to
Messages for four seconds" into "left the meeting".

Video capture *does* stop when backgrounded; the OS suspends the camera.
It resumes on return.

Whether a backgrounded user should stay in the room is a product
decision, so the SDK leaves it to you:

```ts
new Raven({
  onAppStateChange: (state) => {
    if (state === 'background') void raven.leave();
  },
});
```

## Audio routing

```ts
await raven.audio.setSpeakerphone(true);
await raven.audio.getOutputs();
await raven.audio.showRoutePicker();     // iOS system sheet
```

The session starts and stops around a call automatically. Prefer
`setSpeakerphone()` over `setOutput()` for a speakerphone button — it
respects a connected headset instead of overriding the user's obvious
intent.

## Error handling

```ts
import { RTCError, RavenPermissionError, isRTCError } from '@corvidhq/react-native';

try {
  await room.enableCamera();
} catch (error) {
  if (error instanceof RavenPermissionError) {
    error.requiresSettings ? openSettings() : promptAgain();
  } else if (isRTCError(error)) {
    console.log(error.code);
  }
}
```

`RavenPermissionError` extends `RTCError`, so existing web error handling
keeps working. Codes are shared across platforms — see
[../error-codes.md](../error-codes.md).

## Production

- **Background audio (iOS):** add the `audio` background mode to
  `Info.plist` or calls end when the app is backgrounded.
- **Proguard (Android):** WebRTC classes are already kept by
  `@livekit/react-native-webrtc`; nothing to add.
- **Simulators can't capture video.** The iOS Simulator and most Android
  emulators have no camera. Test video on real hardware.
- **Cleartext:** use `wss://` and `https://` endpoints. Android blocks
  cleartext by default and you should not work around it.

## Troubleshooting

**Black video, no error.** Almost always permissions. Call
`permissions.check()` and look for `blocked`.

**"RTCPeerConnection is not defined".** The globals weren't registered.
Constructing a `Raven` does it; if you touch WebRTC before that, call
`bootstrapRavenNative()` in `index.js`.

**Remote audio plays from the earpiece.** The audio session isn't
running. Don't pass `manageAudioSession: false` unless you're managing it
yourself.

**Video freezes on reconnect.** Pass `room` to `RavenVideoView` so it
follows track changes.

**Works on Wi-Fi, fails on cellular.** Carrier NAT needs TURN. Forward
the `iceServers` from your token response — omitting it is the usual
cause.

## Architecture

```
@corvidhq/react-native      ← platform layer: video, permissions,
        │                  lifecycle, audio routing
        ├── @corvidhq/rtc    ← shared with web, unmodified
        ├── @corvidhq/chat   ← shared with web, unmodified
        └── @livekit/react-native → native iOS/Android WebRTC
```

Raven's RTC and messaging logic is shared with web. Only the parts that
genuinely differ live in this package. That's why the APIs match — and
why a fix to connection handling lands on both platforms at once.
