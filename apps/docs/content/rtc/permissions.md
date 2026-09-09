---
title: Permissions
description: Camera and microphone access — how each platform asks, and how Raven normalizes the answer.
---

Camera/microphone permission is the one place Web, React Native, and
Flutter genuinely differ — the OS, not Raven, owns the prompt. This page
covers what each SDK does about it.

## Web

The browser owns the prompt entirely — there's no permissions API to
call ahead of time. `enableCamera()`/`enableMicrophone()` triggers it
implicitly the first time a device is requested:

```ts
try {
  await room.enableCamera();
} catch (error) {
  if (error.code === 'CAMERA_PERMISSION_DENIED') {
    // show your own "please allow camera access" UI
  }
}
```

A denial doesn't distinguish "just denied" from "permanently blocked" —
that distinction lives in the browser's own site-settings UI, which
Raven has no API into. Direct the user there generically ("check your
browser's camera permission for this site") rather than guessing.

## React Native

A real permissions module, because the two mobile platforms are
genuinely different underneath:

```ts
import { permissions } from '@ravenkash/react-native';

const status = await permissions.check();
// { camera: 'granted'|'denied'|'blocked'|'undetermined'|'unavailable', microphone: ... }

const result = await permissions.request(['camera', 'microphone']); // prompts; never throws
await permissions.require(['camera']); // prompts; throws RavenPermissionError on anything but granted
```

- **Android** has a real status API — `check()` reports the truth
  without prompting.
- **iOS** has no such API reachable from JavaScript. `check()` honestly
  reports `undetermined` there rather than guessing; `request()` does
  the real work by asking for the device and reading the outcome.
- **`blocked`** means re-prompting does nothing — the user denied
  permanently (Android's "don't ask again", or any iOS denial after the
  first). `RavenPermissionError.requiresSettings` is `true` in exactly
  this case, so your UI can send the user to Settings instead of
  uselessly prompting again:

```ts
import { permissions, isRavenPermissionError } from '@ravenkash/react-native';

try {
  await permissions.require(['camera']);
} catch (error) {
  if (isRavenPermissionError(error) && error.requiresSettings) {
    // open Settings — prompting again shows no dialog on this platform
  }
}
```

`raven.join()` calls `permissions.request()` for you by default,
non-throwing — a user who declines the camera can still join to listen.
Pass `{ requestPermissions: false }` to skip this if your app has its
own pre-call permission screen.

## Flutter

```dart
final granted = await RavenPermissions.request();
// { RavenPermission.camera: true, RavenPermission.microphone: false }

await RavenPermissions.require(); // throws RavenPermissionException
```

Flutter has no permissions API in the framework itself, and this
package doesn't require `permission_handler` just for this —
`request()` genuinely prompts (asking for the device is what raises the
OS dialog), but a pure "what's the status right now" check isn't
possible without a native module. If you need pre-flight status, or the
denied-vs-permanently-denied distinction React Native gets natively, add
`permission_handler` alongside Raven:

```dart
final status = await Permission.camera.status;
if (status.isPermanentlyDenied) {
  await openAppSettings();
} else {
  await RavenPermissions.require([RavenPermission.camera]);
}
```

## Platform manifest/plist setup

None of the above works without also declaring the permission in your
app's own configuration — Raven can prompt, but can't add the
declaration for you.

**React Native and Flutter, `ios/*/Info.plist`:**

```xml
<key>NSCameraUsageDescription</key>
<string>Camera access is used for video calls.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Microphone access is used for calls.</string>
```

**React Native and Flutter, `android/app/src/main/AndroidManifest.xml`:**

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

## Common errors

| Error | Platform | Why | Fix |
|---|---|---|---|
| Missing an iOS usage string doesn't error — **the app crashes** | React Native, Flutter | iOS terminates the process the instant it asks for a permission with no matching `Info.plist` string. | Add both `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` even if you only use one. |
| `CAMERA_PERMISSION_DENIED`/`MICROPHONE_PERMISSION_DENIED` | Web | User declined the browser prompt. | Show your own explanation; the browser owns re-prompting. |
| `RavenPermissionError` with `requiresSettings: true` | React Native | Permanently denied — Android "don't ask again," or a repeat iOS denial. | Send the user to system Settings; re-prompting shows nothing. |
| `RavenPermissionException` (`permanentlyDenied: false`) | Flutter | The platform doesn't tell Raven whether a denial was permanent. | Add `permission_handler` if you need that distinction — see above. |

## Production notes

- Request permission close to the moment you need it (joining a call),
  with context in your own UI first — an unexplained system prompt gets
  declined far more often.
- A declined camera/microphone should not block joining — let the user
  attend as a listener/viewer rather than failing the whole join.
- Test the actual "permanently denied" path on a real device before
  shipping; simulators and emulators don't always reproduce it faithfully.

## Related

- [Audio & Video](/rtc/audio-and-video) — where a permission error actually surfaces.
- [React Native SDK](/sdk/react-native) and [Flutter SDK](/sdk/flutter) — full platform setup.
- [Troubleshooting](/rtc/troubleshooting) — "black video, no error" is almost always this.
