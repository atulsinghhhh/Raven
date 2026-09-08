export { EffectsPipeline, createEffectsPipeline } from './pipeline';
export type { EffectsPipelineEventMap } from './pipeline';

export { filters, FILTER_DEFINITIONS } from './filters/index';
export type { FilterConfig } from './filters/index';

export { presets } from './presets';
export type { Preset } from './presets';

export { beauty } from './foundations/beauty';
export type { BeautySmoothConfig } from './foundations/beauty';

export { createFaceDetector } from './foundations/face-detector';
export type { FaceDetector, FaceRegion, FaceLandmark, FaceLandmarkName } from './foundations/face-detector';

export { createBackgroundProcessor } from './foundations/background';
export type { BackgroundProcessor, BackgroundProcessorConfig, BackgroundMode } from './foundations/background';

export { createAROverlay } from './foundations/ar';
export type { AROverlay, ARAnchor, ARAsset, AnchorTransform } from './foundations/ar';

export { EffectsError, isEffectsError } from './errors';
export type { EffectsErrorCode } from './errors';

export { detectCapabilities } from './capabilities';
export type { EffectsCapabilities, EngineKind } from './capabilities';

export { EFFECT_SECURITY_LIMITS, validateAsset, validateParam, validateParams } from './security';
export type { AssetDescriptor } from './security';

export type {
  ColorOp,
  ColorOpParams,
  EffectCategory,
  EffectDefinition,
  EffectInstance,
  EffectOp,
  EffectParamSpec,
  EffectPlatform,
  EffectPlatformSupport,
  EffectSupportStatus,
  RavenEffect,
  SpatialOp,
} from './types';

export type { PipelineStats } from './engine/types';

import { createEffectsPipeline } from './pipeline';
import { filters } from './filters/index';
import { presets } from './presets';
import { beauty } from './foundations/beauty';
import { createFaceDetector } from './foundations/face-detector';
import { createBackgroundProcessor } from './foundations/background';
import { createAROverlay } from './foundations/ar';
import { detectCapabilities } from './capabilities';

/**
 * Raven Effects' public entry point. Shaped the same way `@corvidhq/client`'s
 * `Raven` facade composes `@corvidhq/rtc` and `@corvidhq/chat`:
 *
 * ```ts
 * const effects = raven.effects.createPipeline();
 * effects.add(raven.effects.filters.brightness({ value: 0.2 }));
 * effects.applyPreset(raven.effects.presets.cinematic);
 * camera.attachEffects(effects); // @corvidhq/rtc's LocalTrack
 * ```
 */
export const effects = {
  createPipeline: createEffectsPipeline,
  filters,
  presets,
  beauty,
  createFaceDetector,
  createBackgroundProcessor,
  createAROverlay,
  detectCapabilities,
};
