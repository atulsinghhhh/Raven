---
title: Effects API Reference
description: Full type signatures for @corvidhq/effects — pipeline, filters, presets, errors, security, and the foundations for face/beauty/background/AR.
---

## `effects`

The top-level object (`import { effects } from '@corvidhq/effects'`, or
`raven.effects` if you're composing it yourself alongside
`@corvidhq/client`):

```ts
const effects = {
  createPipeline(): EffectsPipeline;
  filters: typeof filters;
  presets: typeof presets;
  beauty: typeof beauty;
  createFaceDetector(): FaceDetector;
  createBackgroundProcessor(): BackgroundProcessor;
  createAROverlay(faceDetector: FaceDetector): AROverlay;
  detectCapabilities(): EffectsCapabilities;
};
```

## `EffectsPipeline`

```ts
class EffectsPipeline extends TypedEventEmitter<EffectsPipelineEventMap> {
  readonly id: string;
  readonly effects: readonly EffectInstance[];
  readonly isEnabled: boolean;
  readonly engineKind: 'webgl2' | 'canvas2d' | 'passthrough' | undefined;

  add(config: FilterConfig): EffectInstance;
  addCustomEffect(effect: RavenEffect, initialParams?: ColorOpParams): EffectInstance;
  applyPreset(preset: Preset): EffectInstance[];
  remove(effectOrId: EffectInstance | string): void;
  update(effectId: string, params: Partial<ColorOpParams>): void;
  reorder(effectId: string, toIndex: number): void;
  enable(effectId?: string): void;
  disable(effectId?: string): void;
  clear(): void;
  getStats(): PipelineStats | undefined;
}
```

See [Pipeline](/effects/pipeline) for the event catalogue
(`effectAdded`/`effectRemoved`/`effectUpdated`/`reordered`/`enabled`/
`disabled`/`cleared`/`error`/`stats`).

## Filters

```ts
interface EffectParamSpec {
  min: number;
  max: number;
  default: number;
  description: string;
}

interface FilterConfig {
  type: string;
  name: string;
  params: ColorOpParams; // Record<string, number>
}

const filters: {
  brightness(params?: { value?: number }): FilterConfig;   // -1..1, default 0
  contrast(params?: { value?: number }): FilterConfig;      // -1..1, default 0
  saturation(params?: { value?: number }): FilterConfig;    // 0..2, default 1
  exposure(params?: { stops?: number }): FilterConfig;      // -2..2, default 0
  temperature(params?: { value?: number }): FilterConfig;   // -1..1, default 0
  tint(params?: { value?: number }): FilterConfig;          // -1..1, default 0
  grayscale(params?: { amount?: number }): FilterConfig;    // 0..1, default 1
  sepia(params?: { amount?: number }): FilterConfig;        // 0..1, default 1
  blur(params?: { radius?: number }): FilterConfig;         // 0..20, default 6
};

const presets: {
  vivid: () => FilterConfig[];
  warm: () => FilterConfig[];
  cool: () => FilterConfig[];
  cinematic: () => FilterConfig[];
  vintage: () => FilterConfig[];
};

const beauty: {
  smooth(params?: { amount?: number }): FilterConfig; // type: 'beautySmooth', 0..1, default 0.4
};
```

Every factory throws `EffectsError` (`RAVEN_EFFECT_INVALID_CONFIG`) for
an out-of-range or unknown parameter — see [Filters](/effects/filters).

## `EffectsError`

```ts
type EffectsErrorCode =
  | 'RAVEN_EFFECT_UNSUPPORTED'
  | 'RAVEN_EFFECT_INVALID_CONFIG'
  | 'RAVEN_EFFECT_PROCESSING_FAILED'
  | 'RAVEN_EFFECT_PERMISSION_DENIED'
  | 'RAVEN_EFFECT_RESOURCE_LIMIT';

class EffectsError extends Error {
  readonly code: EffectsErrorCode;
  readonly cause?: unknown;
}

function isEffectsError(value: unknown): value is EffectsError;
```

| Code | Meaning |
| --- | --- |
| `RAVEN_EFFECT_UNSUPPORTED` | This runtime can't run the pipeline (no DOM, or missing WebGL2/Canvas2D/`captureStream()`), or a capability (face detection, background, AR) hasn't shipped. |
| `RAVEN_EFFECT_INVALID_CONFIG` | A parameter is out of range, unknown, or non-finite. |
| `RAVEN_EFFECT_PROCESSING_FAILED` | A shader/frame failed to render mid-stream. |
| `RAVEN_EFFECT_PERMISSION_DENIED` | An operation Raven Effects refuses on principle — e.g. loading a remote effect/shader/script. |
| `RAVEN_EFFECT_RESOURCE_LIMIT` | Pipeline length (16) or an asset's size/dimensions exceeded a security limit. |

## Capability detection

```ts
interface EffectsCapabilities {
  webgl2: boolean;
  offscreenCanvas: boolean;
  captureStream: boolean;
  requestVideoFrameCallback: boolean;
  recommendedEngine: 'webgl2' | 'canvas2d' | 'passthrough';
}

function detectCapabilities(): EffectsCapabilities;
```

## Security

```ts
const EFFECT_SECURITY_LIMITS = {
  MAX_ASSET_BYTES: 5 * 1024 * 1024,
  MAX_ASSET_DIMENSION: 4096,
  ALLOWED_ASSET_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  MAX_PIPELINE_LENGTH: 16,
};

function validateParam(name: string, value: number, spec: EffectParamSpec): void;
function validateParams(params: Record<string, number>, specs: Record<string, EffectParamSpec>): void;
function validateAsset(asset: { byteLength: number; mimeType: string; width?: number; height?: number }): void;
```

Raven Effects never loads a shader, script, or WASM module from a URL —
there is no `loadEffectFromUrl()`-style API. See
[Custom effects](#custom-effects) below.

## Custom effects

```ts
interface RavenEffect {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly supportedPlatforms: ('web' | 'react' | 'react-native' | 'flutter')[];
  readonly parameters: Record<string, EffectParamSpec>;
  initialize(): void | Promise<void>;
  process(params: ColorOpParams): EffectOp;   // returns the actual GPU/CPU operation
  update(params: ColorOpParams): void;
  destroy(): void | Promise<void>;
}

pipeline.addCustomEffect(effect: RavenEffect, initialParams?: ColorOpParams): EffectInstance;
```

`addCustomEffect()` accepts only an in-process object your own code
already trusts — Raven Effects has no sandboxed execution model yet, so
there's deliberately no way to register an effect from an untrusted
source. `initialize()` runs once on registration; `update()` runs on
every `pipeline.update(effectId, params)` call, followed by `process()`
to refresh the op; `destroy()` runs on `remove()`/`clear()`.

## Face detection (planned)

```ts
interface FaceRegion {
  id: string;
  boundingBox: { x: number; y: number; width: number; height: number }; // normalized [0,1]
  landmarks: FaceLandmark[];
  confidence: number;
}

interface FaceDetector {
  isSupported(): boolean;       // always false in this release
  detect(): Promise<FaceRegion[]>; // always rejects with RAVEN_EFFECT_UNSUPPORTED
  onFacesChanged(handler: (faces: FaceRegion[]) => void): () => void;
}
```

No face detection model ships in this release. `createFaceDetector()`
returns a real object whose `isSupported()` reports `false` — check it
before calling `detect()`, don't rely on the rejection alone.

## Background blur/replacement (planned)

```ts
interface BackgroundProcessor {
  isSupported(): boolean;  // always false in this release
  configure(config: { mode: 'blur' | 'replace'; blurAmount?: number; replacementImage?: ImageBitmap | HTMLImageElement }): void;
}
```

Requires a segmentation model this release doesn't ship — `configure()`
throws `RAVEN_EFFECT_UNSUPPORTED`.

## AR overlays (planned)

```ts
interface AROverlay {
  isSupported(): boolean; // delegates to the FaceDetector it was created with
  attach(asset: { id: string; image: ImageBitmap | HTMLImageElement }, anchor: { id: string; landmarkTarget: string }): ARAnchor;
  detach(anchorId: string): void;
}
```

Depends on face tracking, above — `attach()` throws
`RAVEN_EFFECT_UNSUPPORTED` until that ships.

## Related

- [Pipeline](/effects/pipeline)
- [Filters](/effects/filters)
- [Troubleshooting](/effects/troubleshooting)
