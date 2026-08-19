---
title: Flutter
description: RavenEffectsPipeline — real filter/preset configuration in Dart. No native frame engine and no RavenRoom integration point yet.
---

**Maturity: configuration is production; RTC integration is planned.**
Flutter's Effects surface is narrower than React Native's today — read
[What's not here yet](#whats-not-here-yet) before you build against it.

## What's production today

`RavenEffectsPipeline` and its filter/preset builders, exported from
`raven_rtc`, are real Dart — the same parameter ranges and preset
compositions as `@raven/effects` on web:

```dart
import 'package:raven_rtc/raven_rtc.dart';

final pipeline = RavenEffectsPipeline();
pipeline.applyPreset(RavenEffectPresets.cinematic);
pipeline.add(RavenEffectFilters.brightness(value: 0.2));

pipeline.addListener(() {
  // pipeline extends ChangeNotifier — rebuild a widget the same way
  // you'd listen to a RavenRoom.
});
```

Invalid parameters throw `RavenEffectsException` with a
`RavenEffectsErrorCode` (`unsupported`, `invalidConfig`, `resourceLimit`)
— the same three-way split as web's `EffectsErrorCode`, scoped to what
this release actually needs.

```dart
try {
  RavenEffectFilters.brightness(value: 5); // out of range
} on RavenEffectsException catch (e) {
  print(e.code); // RavenEffectsErrorCode.invalidConfig
}
```

## What's not here yet

Two things, and they're different gaps:

1. **No native frame-processing engine** — same situation as
   [React Native](/effects/react-native).
2. **No `RavenRoom` integration point at all.** Unlike web and React
   Native, `RavenRoom` doesn't currently expose a track handle separate
   from `enableCamera()` (which captures and publishes in one native
   call — see [Audio & Video](/rtc/audio-and-video#create-first-publish-later)
   for the equivalent web-only `createCameraTrack()`/`publish()` split).
   So there is intentionally no `room.attachCameraEffects(...)` method in
   this release — shipping one that silently did nothing would be worse
   than not shipping it. `RavenEffectsPipeline` today is configuration
   you can build, validate, and persist; wiring it into a live camera
   track is future work, tracked alongside the native engine itself.

## Planned architecture

```
Flutter
    ↓
Raven Effects API
    ↓
Native Effects Engine
    ↓
GPU
    ↓
Raven RTC
```

A `MethodChannel`/`PlatformView`-based Metal pipeline on iOS and an
OpenGL ES/Camera2 pipeline on Android, plus a `RavenRoom` track handle to
attach to — tracked in the [dashboard's Effects section](/effects#supported-platforms).

## Related

- [React Native](/effects/react-native) — closer to shipping; the same architecture, one step ahead.
- [Filters](/effects/filters) — the parameter ranges `RavenEffectFilters` mirrors exactly.
