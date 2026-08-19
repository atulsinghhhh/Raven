---
title: React Native SDK
description: The same API as Raven Web — the Room class is the same class.
---

```tsx
import { Raven, RavenVideoView } from '@raven/react-native';

const raven = new Raven({ token, endpoint });
const room = await raven.join('room_123');

await room.enableCamera();
await room.enableMicrophone();
```

If that looks like the web SDK, that's the point — and it isn't a
resemblance. The `Room` you get back is the *same class* `@raven/rtc`
returns in a browser. Everything you know about rooms, participants,
tracks, and events on web is true here, and a fix to that logic lands on
both platforms at once.

## Install

> **Not published to npm yet.** The commands below are what installation
> will look like once these packages are released. Until then, install
> from a local checkout — see [Installing from source](/getting-started/installing-from-source).

```bash
npm install @raven/react-native @raven/rtc @raven/chat \
            @livekit/react-native @livekit/react-native-webrtc

cd ios && pod install   # iOS only
```

The two `@livekit/*` packages are required native modules, not a
separate SDK to integrate with — React Native's autolinking needs them
installed directly in your app for the native WebRTC implementation to
build for iOS/Android. You never import or call them; everything you
write is `@raven/react-native`'s API.

**Permissions** — the SDK can't add these for you.

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
app** the instant it asks, surfacing as an App Store review failure
rather than a bug report.

## Initializing

RTC and chat are independent, and so are their credentials:

```ts
new Raven({ token, endpoint });                       // a call, with or without chat
new Raven({ token, endpoint, chatToken, chatApiUrl }); // both
new Raven({ chatToken, chatApiUrl });                  // messaging only — no RTC connection is ever created
```

`raven.hasRtc` tells you which you got — what a shared component needs
to decide whether to render call controls. Calling `join()` on a
messaging-only instance throws immediately with an error that says so,
checked *before* any permission prompt or audio session starts.

## Joining

```ts
const room = await raven.join('room_123');
await raven.leave();      // leaves the room, keeps chat connected
await raven.dispose();    // tears down everything, including chat
```

`join()` requests camera and microphone permission by default — on
mobile, discovering you can't publish mid-call is worse than being asked
up front. A refusal doesn't block joining; a user who declined the
camera can still watch and listen.

## Rendering video

```tsx
<RavenVideoView participant={remote} room={room} style={{ flex: 1 }} />
<RavenVideoView participant={room.localParticipant} room={room} style={pip} zOrder={1} />
```

Pass `room` and the view follows track changes — published, unpublished,
muted, resubscribed — by itself.

## Chat

Present as `raven.chat` when you passed a `chatToken`:

```ts
const raven = new Raven({ chatToken: session.token, chatApiUrl: session.apiUrl });
await raven.chat!.connect('room_123');
await raven.chat!.send('Hello everyone!');
```

Everything else is `@raven/chat`'s API unchanged — `messages.list()`,
`startTyping()`, `markAsRead()`, presence, threads. It's the same
client, so [Chat](/chat) applies verbatim.

## Reconnection

Handled for you — bounded exponential backoff, re-joins rooms, gives up
rather than looping forever. Install
`@react-native-community/netinfo` (optional) for connectivity-aware
reconnects (a Wi-Fi → cellular handover triggers a fast reconnect
instead of waiting out an ICE timeout).

## Lifecycle

The SDK watches `AppState` and reports transitions, but deliberately
**does not disconnect on background** — dropping the socket on a brief
app-switch would turn "checked a notification" into "left the meeting."
Video capture does stop when backgrounded (the OS suspends the camera)
and resumes on return. Whether a backgrounded user should stay in the
room is your call:

```ts
new Raven({
  onAppStateChange: (state) => {
    if (state === 'background') void raven.leave();
  },
});
```

## Production notes

- **Background audio (iOS)**: add the `audio` background mode to
  `Info.plist`, or calls end when the app is backgrounded.
- **Simulators can't capture video** — the iOS Simulator and most
  Android emulators have no camera. Test video on real hardware.
- **Cleartext**: use `wss://`/`https://`. Android blocks cleartext by
  default; don't work around it.

## Troubleshooting

- **"RTCPeerConnection is not defined"** — the WebRTC globals weren't
  registered. Constructing a `Raven` does this automatically; if you
  touch WebRTC before that, call `bootstrapRavenNative()` in `index.js`.
- **Black video, no error** — almost always permissions; call
  `permissions.check()` and look for `blocked`.
- **Works on Wi-Fi, fails on cellular** — carrier NAT needs TURN. Forward
  `iceServers` from your token response.

Full API reference (permissions module, audio routing, error types):
`@raven/react-native`'s exported types.
