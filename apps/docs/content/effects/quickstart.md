---
title: Effects Quickstart
description: Install, build a pipeline, attach it to a camera — the shortest real path to a filtered call.
---

**Prerequisites:** a joined room with a published camera — see
[RTC → Quickstart](/rtc/quickstart) or
[Live Streaming → Quickstart](/live-streaming/quickstart).

## 1. Install

<Tabs>
<Tab title="Web">

```bash
npm install @ravenkash/effects
```

`@ravenkash/rtc` already depends on `@ravenkash/effects`, so
`camera.attachEffects()` is available even without installing it
directly — install it yourself only to build filter/preset configs
(`effects.filters.*`, `effects.presets.*`).

</Tab>
<Tab title="React">

```bash
npm install @ravenkash/effects @ravenkash/react
```

</Tab>
</Tabs>

## 2. Build a pipeline

```ts
import { effects } from '@ravenkash/effects';

const pipeline = effects.createPipeline();

pipeline.add(effects.filters.brightness({ value: 0.2 }));
pipeline.add(effects.filters.saturation({ value: 1.2 }));
```

Or start from a preset:

```ts
pipeline.applyPreset(effects.presets.cinematic);
```

## 3. Attach it to the camera

<Tabs>
<Tab title="Web">

```ts
const camera = await room.enableCamera();
await camera.attachEffects(pipeline);

// Later, to stop processing and restore the original camera feed:
await camera.detachEffects();
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useCamera, useCameraEffects, effectPresets } from '@ravenkash/react';

function EffectsPanel() {
  const camera = useCamera();
  const effects = useCameraEffects();

  return (
    <div>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
        Camera: {camera.enabled ? 'on' : 'off'}
      </button>
      <button onClick={() => effects.applyPreset(effectPresets.cinematic)}>Cinematic</button>
      <button onClick={() => effects.clear()}>Reset</button>
      <p>{effects.isAttached ? `${effects.effects.length} effect(s) active` : 'Not attached yet'}</p>
    </div>
  );
}
```

`useCameraEffects()` owns one pipeline for the lifetime of the component
and attaches/detaches it automatically as the camera track is
enabled/disabled — see [React](/effects/react) for the full hook API.

</Tab>
</Tabs>

`attachEffects()` swaps the published track in place — the RTC session
never disconnects, reconnects, or renegotiates, and audio is untouched.

## What if the browser can't run it?

`attachEffects()` never throws for a GPU/rendering failure. If this
runtime has no WebGL2, no Canvas2D, or no `captureStream()` support, the
pipeline passes the original camera track through unmodified and emits
an `error` event on the pipeline (`RAVEN_EFFECT_UNSUPPORTED`) — the call
keeps working either way. See [Performance](/effects/performance) for
how to detect this ahead of time and [Troubleshooting](/effects/troubleshooting)
for what to check first.

## Related

- [Filters](/effects/filters) — every parameter and its valid range.
- [Pipeline](/effects/pipeline) — the full lifecycle API and event catalogue.
- [RTC Integration](/effects/rtc-integration)
