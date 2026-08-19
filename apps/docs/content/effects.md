---
title: Effects Overview
description: A reusable real-time video effects pipeline shared by Raven RTC and Raven Live Streaming — filters, presets, and the shape of a custom effect.
---

Raven Effects processes a publisher's camera before it's sent anywhere.
You think about **Raven Effects** — never about LiveKit, WebGL, or which
transport carries the video underneath.

```
Camera
  ↓
Raven Video Track
  ↓
Raven Effects Pipeline
  ↓
Processed Video Track
  ↓
Raven RTC / Live Streaming
  ↓
Remote Participants / Viewers
```

Effects run **once**, on the publisher's machine. A remote participant or
a live-stream viewer receives the already-processed video — nothing
re-runs per viewer, and viewers never need the Effects SDK themselves.

## The shapes

```
EffectsPipeline        an ordered, mutable list of effects
  ├── filters            brightness, contrast, saturation, exposure,
  │                       temperature, tint, grayscale, sepia, blur
  ├── presets             vivid, warm, cool, cinematic, vintage —
  │                       pure compositions of the filters above
  └── beauty.smooth()      basic whole-frame smoothing (production)
```

One pipeline attaches to one camera track, on Raven RTC or Raven Live
Streaming — the same class either way, since a live stream's camera is
an ordinary RTC track underneath.

## Quickstart

```ts
import { createRTCClient } from '@corvidhq/rtc';
import { effects } from '@corvidhq/effects';

const client = createRTCClient({ token, endpoint, iceServers });
const room = await client.join('room-123');
const camera = await room.enableCamera();

const pipeline = effects.createPipeline();
pipeline.applyPreset(effects.presets.cinematic);

await camera.attachEffects(pipeline);
// camera.detachEffects() reverts to the unmodified track at any time.
```

See [Quickstart](/effects/quickstart) for the full walkthrough, including
what happens when a browser can't run the pipeline at all.

## Supported platforms

| Capability | Web | React | React Native | Flutter |
| --- | --- | --- | --- | --- |
| Filters & presets (configuration) | Production | Production | Production | Production |
| Pipeline lifecycle (add/remove/update/reorder/enable/disable/clear) | Production | Production | Production | Production |
| RTC / Live Streaming integration (`camera.attachEffects()`) | Production | Production | Planned | Planned |
| Face detection, background blur/replacement, AR overlays | Planned | Planned | Planned | Planned |

"Configuration" and "integration" are listed separately on purpose: you
can build and validate a pipeline in JS/Dart on every platform today —
what's missing on React Native and Flutter is a native engine to run it
against a live camera track. See [React Native](/effects/react-native)
and [Flutter](/effects/flutter) for exactly what that means in practice.

## Pages in this section

- [Quickstart](/effects/quickstart)
- [Filters](/effects/filters) — every basic filter, with its parameter range
- [Presets](/effects/presets)
- [Pipeline](/effects/pipeline) — lifecycle, events, error handling
- [RTC Integration](/effects/rtc-integration)
- [Live Streaming Integration](/effects/live-streaming)
- [React](/effects/react)
- [React Native](/effects/react-native)
- [Flutter](/effects/flutter)
- [Performance](/effects/performance)
- [Troubleshooting](/effects/troubleshooting)
- [API Reference](/effects/api-reference)

## Related

- [RTC → Audio & Video](/rtc/audio-and-video) — the camera/microphone model effects attach to.
- [Live Streaming → Filters & Effects](/live-streaming/filters) — the same pipeline, applied to a stream's host.
