---
title: Effects in React
description: useCameraEffects() — Raven Effects for @corvidhq/react, built on the same store/hook pattern as every other hook in the package.
---

`@corvidhq/react` doesn't implement a separate effects engine — it
consumes `@corvidhq/effects` and `@corvidhq/rtc`'s `LocalTrack.attachEffects()`
exactly like the rest of the package wraps `@corvidhq/rtc`.

## `useCameraEffects()`

```tsx
'use client';
import { useCameraEffects, effectFilters, effectPresets } from '@corvidhq/react';

function EffectsPanel() {
  const effects = useCameraEffects();

  return (
    <div>
      <button onClick={() => effects.add(effectFilters.brightness({ value: 0.2 }))}>+ Brightness</button>
      <button onClick={() => effects.applyPreset(effectPresets.cinematic)}>Cinematic</button>
      <button onClick={() => effects.disable()}>Bypass</button>
      <button onClick={() => effects.clear()}>Reset</button>
      {effects.error && <p role="alert">{effects.error.code}</p>}
      <p>{effects.isAttached ? `${effects.effects.length} effect(s)` : 'Camera not enabled yet'}</p>
    </div>
  );
}
```

Must be called inside `<RavenRoom>` (or `<RavenLiveStream>`, which shares
the same underlying store) — same requirement as `useCamera()`.

### Return value

```ts
interface UseCameraEffectsResult {
  pipeline: EffectsPipeline;   // the underlying pipeline, for advanced use
  effects: readonly EffectInstance[];
  isEnabled: boolean;
  isAttached: boolean;         // true once actively processing the live camera track
  error?: EffectsError;
  add(config: FilterConfig): EffectInstance;
  applyPreset(preset: Preset): EffectInstance[];
  remove(effectOrId: EffectInstance | string): void;
  update(effectId: string, params: Partial<ColorOpParams>): void;
  reorder(effectId: string, toIndex: number): void;
  enable(effectId?: string): void;
  disable(effectId?: string): void;
  clear(): void;
}
```

`useCameraEffects()` creates one `EffectsPipeline` per component
instance and keeps it attached to whatever the current camera track is —
across enable/disable and device switches — for the component's
lifetime, detaching automatically on unmount.

### Why not a global effects store

Unlike `useCamera()`/`useParticipants()`, which read a snapshot the
`RavenRoom` provider owns, effects are inherently local to one pipeline
instance a component is building — there's nothing to share across
components unless you lift `pipeline` up yourself (pass it down as a
prop, or read `effects.pipeline` from a parent).

## Building configs without a hook

`effectFilters`/`effectPresets` (re-exports of `@corvidhq/effects`'s
`filters`/`presets`) work outside React too — useful for validating a
saved user preference before rendering:

```ts
import { effectFilters, isEffectsError } from '@corvidhq/react';

try {
  effectFilters.brightness({ value: userSavedValue });
} catch (error) {
  if (isEffectsError(error)) console.warn(error.code, error.message);
}
```

## Related

- [Pipeline](/effects/pipeline) — the API `useCameraEffects()` wraps.
- [RTC Integration](/effects/rtc-integration)
