---
title: Background Audio
description: Keeping a call's audio alive when a mobile app moves to the background — React Native only; not yet on Flutter.
---

**React Native only.** `@ravenkash/react-native` manages an audio session
around every call; Flutter has no equivalent yet, and web has no
"background" concept in the same sense (a browser tab keeps running
audio when unfocused, subject to the OS's own power-management, which
Livqeno doesn't control on any platform).

## What happens automatically

`Raven` starts an audio session before `join()` connects and stops it on
`leave()`/`dispose()` — you don't manage this yourself unless you opt out:

```ts
new Raven({ manageAudioSession: false }); // your app already owns the audio session
```

The SDK also watches `AppState` and reports transitions, but
**deliberately does not disconnect on background** — dropping the
socket on a brief app-switch would turn "checked a notification" into
"left the meeting." Video capture does stop when backgrounded (the OS
suspends the camera) and resumes automatically on return.

```ts
new Raven({
  onAppStateChange: (state) => {
    // 'active' | 'background' — your call, not automatic
  },
});
```

## Keeping audio alive in the background (iOS)

Video pausing in the background is normal and unavoidable — but audio
continuing (an audio-only call staying live while the user checks
another app) needs one thing Livqeno can't add for you: the `audio`
background mode.

`ios/YourApp/Info.plist`:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

Without it, iOS suspends the app shortly after backgrounding and the
call's audio stops along with everything else — not a Livqeno bug, a
missing platform capability declaration.

## Deciding whether to leave instead

Some apps want backgrounding to end the call rather than keep it alive
silently. That's a product decision Livqeno leaves to you — combine
`onAppStateChange` with `leave()`:

```ts
const raven = new Raven({
  onAppStateChange: (state) => {
    if (state === 'background') void raven.leave();
  },
});
```

## Expected behavior

| App state | Audio | Video | Reconnect logic |
|---|---|---|---|
| Foreground | Live | Live | Normal |
| Background, `audio` mode declared | Live | Paused (OS-suspended camera) | Unaffected — the room stays joined |
| Background, `audio` mode not declared | Stops shortly after backgrounding | Paused | The app itself gets suspended by iOS, not just the call |

## Common errors

| Symptom | Why | Fix |
|---|---|---|
| Call audio cuts out a few seconds after backgrounding | Missing `UIBackgroundModes: audio`. | Add it — see above. There's no code-level workaround. |
| Camera doesn't resume on foreground | Expected on some devices while the OS finishes reclaiming the camera; usually resolves within a second. | If it doesn't recover, check for an unhandled `error` event rather than assuming it's this. |

## Production notes

- Declaring the `audio` background mode is an App Store review
  consideration too — be prepared to explain why the app needs it if asked.
- Don't assume background behavior — test an actual backgrounding
  scenario (lock the screen, switch apps) on a real device, not just a simulator.

## Related

- [Reconnection](/rtc/reconnection#app-lifecycle-react-native) — the
  `AppState`/network-recovery behavior this page builds on.
- [React Native SDK](/sdk/react-native#production-notes) — the full production checklist.
