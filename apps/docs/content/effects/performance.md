---
title: Performance
description: How Raven Effects picks an engine, what it measures, and what it guarantees — and doesn't.
---

Raven Effects makes no blanket performance claim like "60 FPS" — actual
throughput depends on the device's GPU, the number of active filters, and
the resolution being processed. What it does guarantee is graceful
degradation: a call or stream never fails because effects can't keep up.

## Engine selection

```
Camera
 ↓
capability detection
 ↓
WebGL2 available + captureStream()?  → GPU pipeline (webgl2)
captureStream() only?                → CPU pixel-buffer fallback (canvas2d)
neither?                             → passthrough (original track, unmodified)
```

```ts
import { detectCapabilities } from '@ravenkash/effects';

const caps = detectCapabilities();
caps.recommendedEngine; // 'webgl2' | 'canvas2d' | 'passthrough'
```

`pipeline.attachToTrack()` runs this detection automatically — you only
need `detectCapabilities()` directly to decide whether to show a
filter UI at all before the user tries it.

## What each engine actually does

- **WebGL2** — color filters (brightness/contrast/saturation/exposure/temperature/tint/grayscale/sepia)
  fold into one compiled fragment shader pass per contiguous run; `blur`
  and `beautySmooth` get a real two-pass separable Gaussian blur on their
  own render target. Shaders recompile only when the effect list changes
  (add/remove/update/reorder), never per frame.
- **Canvas2D** — the same math, applied per-pixel via `getImageData`/
  `putImageData` on the CPU. Slower, especially at high resolution or with
  `blur` active, but produces identical results to the GPU path.
- **Passthrough** — no processing. The original `MediaStreamTrack` is
  returned unchanged.

## Metrics

```ts
pipeline.getStats();
// { engine, fps, averageFrameTimeMs, droppedFrames, framesProcessed }

pipeline.on('stats', (stats) => { /* emitted every ~2s while attached */ });
```

`fps` and `droppedFrames` are computed from real inter-frame timing
(`requestVideoFrameCallback` where available, `requestAnimationFrame`
otherwise) — never a hardcoded number. A dropped frame is counted when
the gap since the last frame exceeds 1.5× the camera's target frame
interval.

## Reducing load

- Fewer effects, and avoid stacking multiple `blur`/`beautySmooth`
  instances — each is its own render pass.
- Lower `blur`/`beautySmooth` radius — cost scales with radius (tap
  count), not just presence of the effect.
- Prefer `disable()` over `remove()` when a user is likely to re-enable
  the same effect shortly — it skips re-validating and re-adding, though
  the engine still rebuilds its pass list either way.

## Related

- [Troubleshooting](/effects/troubleshooting) — what to check when the pipeline degrades unexpectedly.
- [Pipeline](/effects/pipeline) — the `error`/`stats` event catalogue.
