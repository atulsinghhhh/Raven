---
title: Effects on React Native
description: Filter/preset configuration is real and shared with every other Raven SDK. Native frame processing is planned, not shipped, in this release.
---

**Maturity: configuration is production; native processing is planned.**
This page is explicit about the split because both halves live in the
same import.

## What's production today

`@ravenkash/react-native` re-exports `@ravenkash/effects` unchanged —
building and validating a pipeline works exactly like Web:

```ts
import { createEffectsPipeline, filters, presets } from '@ravenkash/react-native';

const pipeline = createEffectsPipeline();
pipeline.applyPreset(presets.cinematic);
pipeline.add(filters.brightness({ value: 0.2 })); // validated the same way, same error codes
```

None of this touches native code — it's plain, validated JS, useful
today for building a filter-selection UI, persisting a user's chosen
look, or validating a saved preference before rendering.

## What's planned

React Native's camera comes from `react-native-webrtc`, wrapped
by the exact same `Room`/`LocalTrack` classes `@ravenkash/rtc` uses on
web (see [Architecture](/getting-started/architecture)). Because those
classes are shared unmodified, `camera.attachEffects(pipeline)` **exists**
on React Native — but there is no DOM, canvas, or WebGL in this JS
runtime to render into, so it degrades safely:

```ts
const camera = await room.enableCamera();

pipeline.on('error', (error) => {
  console.log(error.code); // 'RAVEN_EFFECT_UNSUPPORTED'
});

await camera.attachEffects(pipeline);
// The published track is unchanged — attachEffects() never throws here,
// and it never fakes a processed frame.
```

This is not a bug to work around — it's the documented behavior until a
native engine ships. Track real status in the
[dashboard's Effects section](/effects#supported-platforms) rather than
assuming from this page alone, since it's kept current with what's
actually in the tree.

## Planned architecture

```
React Native
    ↓
Raven Effects API
    ↓
Native Effects Engine
    ↓
GPU
    ↓
Raven RTC
```

Per-frame processing will happen entirely in native code (a Metal/Core
Image pipeline on iOS, an OpenGL ES/Camera2 pipeline on Android) — this
SDK will not route every camera frame through JavaScript for real-time
video. See [Performance](/effects/performance) for why that constraint
exists.

## Related

- [Flutter](/effects/flutter) — the same split, different runtime.
- [RTC Integration](/effects/rtc-integration) — the web/React behavior this will eventually match.
