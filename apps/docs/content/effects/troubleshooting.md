---
title: Troubleshooting
description: Common failure modes for Raven Effects, and what to check first.
---

## `attachEffects()` resolves but the video looks unchanged

Check `pipeline.engineKind` right after attaching:

```ts
await camera.attachEffects(pipeline);
console.log(pipeline.engineKind); // 'webgl2' | 'canvas2d' | 'passthrough'
```

`'passthrough'` means this runtime couldn't run the pipeline at all —
expected on React Native/Flutter today (see
[React Native](/effects/react-native) / [Flutter](/effects/flutter)), or
on a browser missing both WebGL2 and `HTMLCanvasElement.captureStream()`.
Also confirm the pipeline actually has enabled effects:
`pipeline.effects.filter(e => e.enabled)` — an empty or fully-disabled
pipeline renders the identity pass, which looks like no change because it
*is* no change.

## `add()`/`update()` throws `RAVEN_EFFECT_INVALID_CONFIG`

The value is outside the documented range for that parameter — see
[Filters](/effects/filters) for every filter's exact range. This is
intentional: Raven Effects rejects invalid values rather than silently
clamping them, so the bug surfaces immediately instead of shipping a
slightly-wrong filter to production.

## `add()` throws `RAVEN_EFFECT_RESOURCE_LIMIT`

The pipeline already has 16 effects
(`EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH`) — remove or `clear()`
before adding more. The same code is thrown by `validateAsset()` for an
oversized/too-large-dimension asset, if you're building a custom effect.

## `pipeline.on('error')` fires with `RAVEN_EFFECT_UNSUPPORTED`

The environment can't run the pipeline at all (no DOM, or no
WebGL2/Canvas2D/`captureStream()`). The camera keeps publishing the
original, unmodified track — this event exists so you can inform the
user why their selected filter isn't visible, not because anything
failed silently. See [Performance](/effects/performance#engine-selection).

## Effects work in Chrome/Firefox but not Safari

Check `detectCapabilities().webgl2` specifically — older Safari versions
support `captureStream()` without WebGL2, which routes through the
Canvas2D fallback (still correct, just slower). If both are `false`, the
pipeline is passthrough on that browser/OS combination.

## RTC session drops when I call `attachEffects()`

It shouldn't — `attachEffects()` uses `replaceTrack()` on the existing
sender, never a full unpublish/republish or reconnect. If you observe a
drop, check whether something *else* triggered a reconnect around the
same time (see [Reconnection & Network Quality](/rtc/reconnection)) — the
two are independent, but it's easy to conflate them if they happen close
together during testing.

## Related

- [Pipeline → Failure handling](/effects/pipeline#failure-handling)
- [API Reference](/effects/api-reference) — every error code.
