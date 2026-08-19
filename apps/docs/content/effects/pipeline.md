---
title: Pipeline
description: The EffectsPipeline lifecycle — add, remove, update, reorder, enable, disable, clear — plus its events and how it degrades.
---

`EffectsPipeline` (`effects.createPipeline()`) is an ordered, mutable
list of effects. It exists independently of any camera or track — build
one, configure it, and attach it later with
[`camera.attachEffects()`](/effects/rtc-integration).

## Lifecycle

```ts
const pipeline = effects.createPipeline();

const instance = pipeline.add(effects.filters.brightness({ value: 0.2 }));
pipeline.update(instance.id, { value: 0.5 });     // partial merge, re-validated
pipeline.reorder(instance.id, 0);                  // move to index 0
pipeline.disable(instance.id);                     // this effect only
pipeline.enable(instance.id);
pipeline.remove(instance);                         // accepts an instance or an id string

pipeline.disable();                                // whole pipeline — camera publishes unmodified
pipeline.enable();
pipeline.clear();                                  // removes every effect
```

`enable()`/`disable()` called with no argument toggle the whole
pipeline; called with an effect id, they toggle just that effect. A
pipeline is capped at 16 effects (`EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH`)
— `add()` past that throws `RAVEN_EFFECT_RESOURCE_LIMIT`.

## State

```ts
pipeline.effects;    // readonly EffectInstance[], in render order
pipeline.isEnabled;  // whole-pipeline bypass state
pipeline.engineKind; // 'webgl2' | 'canvas2d' | 'passthrough' | undefined (before attach)
pipeline.getStats();
```

## Events

```ts
pipeline.on('effectAdded', (effect) => {});
pipeline.on('effectRemoved', (effectId) => {});
pipeline.on('effectUpdated', (effect) => {});
pipeline.on('reordered', (orderedIds) => {});
pipeline.on('enabled', (effectId?) => {});
pipeline.on('disabled', (effectId?) => {});
pipeline.on('cleared', () => {});
pipeline.on('error', (error) => {});   // an EffectsError — processing failed, the call keeps running
pipeline.on('stats', (stats) => {});   // emitted every ~2s while attached
```

`off()`/`once()`/`removeAllListeners()` work the same way as
[`@corvidhq/rtc`'s `Room`](/rtc#events) — this is the same
`TypedEventEmitter` convention, not a separate one.

## Ordering matters

Effects apply in the order they appear in `pipeline.effects`. Color
filters (brightness, contrast, saturation, exposure, temperature, tint,
grayscale, sepia) fold into one shader pass and compose left-to-right;
`blur` gets its own pass wherever it sits in the list. `reorder()`
changes what a chain actually renders, not just bookkeeping order.

## Attaching and detaching

`attachToTrack()`/`detach()` are internal — call
[`camera.attachEffects(pipeline)`](/effects/rtc-integration) instead. A
pipeline can only be attached to one track at a time; attaching a second
track automatically detaches the first.

## Failure handling

Processing failures never stop the call. If the engine can't start (no
WebGL2/Canvas2D/`captureStream()`) or a frame fails mid-stream, the
pipeline emits `error` with an [`EffectsError`](/effects/api-reference#effectserror)
and the camera keeps publishing — either the original track (engine
never started) or the last good processed frame (a transient failure
mid-stream). See [Troubleshooting](/effects/troubleshooting).

## Related

- [RTC Integration](/effects/rtc-integration)
- [Custom effects](/effects/api-reference#custom-effects) — the trusted, in-process `RavenEffect` interface.
