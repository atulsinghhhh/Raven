/**
 * Raven Effects on React Native. Phase 16 architecture; no native engine
 * yet.
 *
 * Filter and preset *configuration* is real and fully shared with every
 * other Raven SDK. `effects.createPipeline()`, `effects.filters.*` and
 * `effects.presets.*` are plain validated JS/TS with no native code
 * anywhere near them, re-exported straight from `@corvidhq/effects`.
 *
 * What doesn't exist yet is a *native* frame-processing engine.
 * `camera.attachEffects(pipeline)`, inherited from `@corvidhq/rtc`'s
 * `LocalTrack` because this SDK reuses that class unmodified instead of
 * wrapping it, degrades safely to the unmodified camera track on React
 * Native today. There's no DOM, WebGL or canvas in this JS runtime to
 * render into. It emits `pipeline.on('error', ...)` with
 * `RAVEN_EFFECT_UNSUPPORTED`, not throwing, and certainly rather
 * than quietly pretending to process frames. The call works either way.
 *
 * The PLANNED architecture, once a native engine ships:
 *
 *   React Native → Raven Effects API → Native Effects Engine → GPU → Raven RTC
 *
 * iOS gets a Metal/Core Image frame processor bridged in as a
 * `MediaStreamTrack` transform; Android an OpenGL ES/Camera2 pipeline.
 * Per-frame work happens entirely in native code. This SDK is never going
 * to route every camera frame through JS or Dart for real-time video (see
 * Phase 16 §11). Status lives in the dashboard's Effects section and in
 * docs/effects/react-native.
 */
export {
  beauty,
  createEffectsPipeline,
  EFFECT_SECURITY_LIMITS,
  filters,
  isEffectsError,
  presets,
} from '@corvidhq/effects';
export type {
  ColorOpParams,
  EffectInstance,
  EffectsError,
  EffectsErrorCode,
  EffectsPipeline,
  FilterConfig,
  Preset,
} from '@corvidhq/effects';

export type EffectsEngineStatus = 'production' | 'planned';

/** Native frame-processing status for this platform. Never claim more than this. */
export const EFFECTS_NATIVE_ENGINE_STATUS: EffectsEngineStatus = 'planned';
