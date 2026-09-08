import type { EffectDefinition } from '../types';
import { clamp01, luma } from './util';

/**
 * Saturation. Blends between grayscale and full colour.
 * `value`: 0 (grayscale) to 2 (double saturation). 1 is no change.
 */
export const saturationDefinition: EffectDefinition = {
  type: 'saturation',
  category: 'color',
  params: {
    value: { min: 0, max: 2, default: 1, description: 'Saturation multiplier, 0 (grayscale) to 2 (double). 1 = no change.' },
  },
  op: {
    kind: 'color',
    glsl: (params) => `{
      float l = dot(color, vec3(0.299, 0.587, 0.114));
      color = clamp(mix(vec3(l), color, ${params.value.toFixed(6)}), 0.0, 1.0);
    }`,
    applyToPixel: ([r, g, b], params) => {
      const l = luma(r, g, b);
      const mix = (c: number) => clamp01((l + (c - l) * params.value) / 255) * 255;
      return [mix(r), mix(g), mix(b)];
    },
  },
};
