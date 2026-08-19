import { EffectsError } from '../errors';
import { boxBlurApprox } from '../filters/blur';
import { validateParams } from '../security';
import type { ColorOpParams, EffectDefinition } from '../types';

/**
 * PRODUCTION: real-time skin smoothing.
 *
 * This is a plain adjustable blur, not a detail-preserving (bilateral /
 * edge-aware) algorithm, and it applies to the whole frame rather than a
 * detected face region — see foundations/face-detector.ts, whose absence is
 * exactly why this can't target skin specifically yet. It is genuinely
 * real-time and GPU-accelerated where available, and does exactly what it
 * says: soften fine detail. A face-aware, detail-preserving version is
 * planned once FaceDetector ships.
 *
 * `amount`: 0 (no smoothing) .. 1 (heavy smoothing, whole-frame blur).
 */
export const beautySmoothDefinition: EffectDefinition = {
  type: 'beautySmooth',
  category: 'spatial',
  params: {
    amount: { min: 0, max: 1, default: 0.4, description: 'Whole-frame smoothing strength, 0 (none) to 1 (heavy). Basic blur-based, not face-aware.' },
  },
  op: {
    kind: 'spatial',
    // Real GLSL work happens in engine/webgl-engine.ts, which maps `amount` to
    // an equivalent blur radius and reuses its separable blur pass — see the
    // module doc there for why blur and beautySmooth share one code path.
    renderGL() {
      /* handled by webgl-engine.ts's pass builder */
    },
    applyToImageData(imageData, params) {
      const radius = Math.round((params.amount ?? 0) * 12);
      if (radius <= 0) return;
      boxBlurApprox(imageData, radius);
    },
  },
};

export interface BeautySmoothConfig {
  type: 'beautySmooth';
  name: string;
  params: ColorOpParams;
}

export function smooth(params: Partial<ColorOpParams> = {}): BeautySmoothConfig {
  const merged: ColorOpParams = { amount: params.amount ?? beautySmoothDefinition.params.amount.default };
  try {
    validateParams(merged, beautySmoothDefinition.params);
  } catch (error) {
    throw error instanceof EffectsError ? error : new EffectsError('RAVEN_EFFECT_INVALID_CONFIG', 'Invalid beauty.smooth() config.', error);
  }
  return { type: 'beautySmooth', name: 'beautySmooth', params: merged };
}

export const beauty = { smooth };
