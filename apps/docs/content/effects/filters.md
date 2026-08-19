---
title: Filters
description: Every basic filter Raven Effects ships, its parameters, valid ranges, and what invalid input does.
---

Every filter below is exported from `effects.filters` (`@corvidhq/effects`,
re-exported as `effectFilters` from `@corvidhq/react`). Each factory
validates its parameters immediately and throws
[`EffectsError`](/effects/api-reference#effectserror) with code
`RAVEN_EFFECT_INVALID_CONFIG` on an out-of-range or unknown value —
invalid configuration never silently clamps.

```ts
effects.filters.brightness({ value: 0.2 });
effects.filters.brightness();              // uses the documented default
effects.filters.brightness({ value: 5 });  // throws RAVEN_EFFECT_INVALID_CONFIG
```

## Color filters

These run as one combined shader pass on the GPU engine, in the order
they were added to the pipeline — see [Pipeline](/effects/pipeline) for
how ordering composes.

| Filter | Parameter | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| `brightness` | `value` | -1 to 1 | 0 | Additive shift applied to every channel. |
| `contrast` | `value` | -1 to 1 | 0 | Scales each channel around mid-gray (0.5). |
| `saturation` | `value` | 0 to 2 | 1 | Blends toward (0) or away from (2) grayscale. |
| `exposure` | `stops` | -2 to 2 | 0 | Multiplicative brightness in photographic stops — each +1 doubles brightness. |
| `temperature` | `value` | -1 to 1 | 0 | Red/blue balance — negative is cooler, positive is warmer. |
| `tint` | `value` | -1 to 1 | 0 | Green/magenta balance. |
| `grayscale` | `amount` | 0 to 1 | 1 | Blend toward fully desaturated. |
| `sepia` | `amount` | 0 to 1 | 1 | Blend toward a classic sepia tone. |

```ts
effects.filters.contrast({ value: 0.15 });
effects.filters.exposure({ stops: 0.5 });
effects.filters.temperature({ value: -0.3 }); // cooler
```

## Spatial filters

Spatial filters read neighboring pixels, so each gets its own render
pass rather than folding into the color shader.

| Filter | Parameter | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| `blur` | `radius` | 0 to 20 (pixels) | 6 | Gaussian blur — a real two-pass separable blur on the GPU engine, a box-blur approximation on the CPU fallback. |

```ts
effects.filters.blur({ radius: 8 });
```

`beauty.smooth({ amount })` is a related, separately-namespaced filter —
see [Presets](/effects/presets#beauty-smoothing) for why it isn't listed
as a basic filter.

## Adding a filter to a pipeline

```ts
const pipeline = effects.createPipeline();
const instance = pipeline.add(effects.filters.brightness({ value: 0.2 }));

instance.id;      // stable id — pass to update()/remove()
instance.enabled; // true by default
instance.params;  // { value: 0.2 }
```

## Related

- [Presets](/effects/presets) — pure compositions of the filters above.
- [Pipeline](/effects/pipeline) — add/remove/update/reorder/enable/disable/clear.
- [API Reference](/effects/api-reference#filters) — full type signatures.
