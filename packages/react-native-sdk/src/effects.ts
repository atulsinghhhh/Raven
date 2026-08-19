/**
 * Raven Effects on React Native — Phase 16 architecture, not a native
 * engine yet.
 *
 * Filter/preset *configuration* is real and fully shared with every other
 * Raven SDK: `effects.createPipeline()`, `effects.filters.*`, and
 * `effects.presets.*` are plain, validated JS/TS with no native code
 * involved, re-exported unchanged from `@corvidhq/effects`.
 *
 * What is NOT implemented yet is a *native* frame-processing engine.
 * `camera.attachEffects(pipeline)` — inherited from `@corvidhq/rtc`'s
 * `LocalTrack`, since this SDK reuses that class unmodified rather than
 * wrapping it — safely degrades to the unmodified camera track on React
 * Native today (there is no DOM/WebGL/canvas in this JS runtime to render
 * into) and emits `pipeline.on('error', ...)` with `RAVEN_EFFECT_UNSUPPORTED`
 * rather than throwing or silently pretending to process frames. The call
 * keeps working either way.
 *
 * PLANNED architecture, once a native engine ships:
 *
 *   React Native → Raven Effects API → Native Effects Engine → GPU → Raven RTC
 *
 * iOS: Metal/Core Image frame processor bridged in as a
 * `MediaStreamTrack` transform. Android: an OpenGL ES/Camera2 pipeline.
 * Per-frame processing would happen entirely in native code — this SDK
 * will never route every camera frame through JS/Dart for real-time video
 * (see Phase 16 §11). Track status in the dashboard's Effects section and
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

/** Native frame-processing status for this platform — never claim more than this. */
export const EFFECTS_NATIVE_ENGINE_STATUS: EffectsEngineStatus = 'planned';
