---
title: Presets
description: Named looks composed entirely from the basic filters — vivid, warm, cool, cinematic, vintage — plus basic beauty smoothing.
---

Presets never implement their own pixel math — each one is a fixed,
ordered list of [filters](/effects/filters) with tuned parameters. There
is exactly one place brightness/contrast/saturation/etc. are actually
computed; presets just call into it.

```ts
type Preset = () => FilterConfig[];
```

## The five presets

```ts
effects.presets.vivid();
effects.presets.warm();
effects.presets.cool();
effects.presets.cinematic();
effects.presets.vintage();
```

| Preset | Composition |
| --- | --- |
| `vivid` | `saturation(1.4)` → `contrast(0.15)` → `brightness(0.03)` |
| `warm` | `temperature(0.35)` → `tint(0.05)` → `saturation(1.1)` |
| `cool` | `temperature(-0.35)` → `saturation(1.05)` |
| `cinematic` | `contrast(0.2)` → `saturation(0.85)` → `temperature(0.1)` |
| `vintage` | `sepia(0.35)` → `contrast(-0.1)` → `saturation(0.7)` → `brightness(0.02)` |

## Applying a preset

```ts
const pipeline = effects.createPipeline();
const instances = pipeline.applyPreset(effects.presets.cinematic);
// instances is the array of EffectInstance this preset added, in order —
// each one is independently update()-able and remove()-able afterward.
```

Applying a preset is exactly equivalent to calling `pipeline.add()` for
each of its filters — nothing about a preset is special once it's in the
pipeline. Combining presets, or mixing a preset with your own filters, is
just calling `applyPreset()` and `add()` on the same pipeline.

## Beauty smoothing

`effects.beauty.smooth({ amount })` is production, but deliberately not
listed as a preset or a basic filter — it's a distinct capability with
its own maturity note. `amount` (0–1, default 0.4) is a plain adjustable
blur, not a face-aware or detail-preserving algorithm: it softens the
*whole frame*, because face-region isolation needs
[face detection](/effects/api-reference#face-detection-planned), which
this release doesn't ship.

```ts
pipeline.add(effects.beauty.smooth({ amount: 0.3 }));
```

## Related

- [Filters](/effects/filters) — the underlying building blocks and their ranges.
- [Pipeline](/effects/pipeline) — lifecycle once effects are in the pipeline.
