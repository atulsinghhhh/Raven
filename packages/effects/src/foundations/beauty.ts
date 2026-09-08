import { EffectsError } from '../errors';
import { boxBlurApprox } from '../filters/blur';
import { validateParams } from '../security';
import type { ColorOpParams, EffectDefinition } from '../types';

/**
 * PRODUCTION: real-time skin smoothing.
 *
 * Be clear about what this is. A plain adjustable blur, not a
 * detail-preserving bilateral or edge-aware algorithm, applied to the whole
 * frame rather than a detected face region. See
 * foundations/face-detector.ts; its absence is precisely why this can't
 * target skin yet.
 *
 * What it does do is genuinely real-time, GPU-accelerated where available,
 * and exactly what it says on the tin: soften fine detail. A face-aware,
 * detail-preserving version is planned for once FaceDetector ships.
 *
 * `amount`: 0 (no smoothing) to 1 (heavy, whole-frame blur).
 */
export const beautySmoothDefinition: EffectDefinition = {
  type: 'beautySmooth',
  category: 'spatial',
  params: {
    amount: { min: 0, max: 1, default: 0.4, description: 'Whole-frame smoothing strength, 0 (none) to 1 (heavy). Basic blur-based, not face-aware.' },
  },
  op: {
    kind: 'spatial',
    // The real GLSL work happens in engine/webgl-engine.ts, which maps
    // `amount` onto an equivalent blur radius and reuses its separable blur
    // pass. The module doc there explains why blur and beautySmooth share
    // one code path.
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
