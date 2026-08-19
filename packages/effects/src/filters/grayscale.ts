import type { EffectDefinition } from '../types';
import { clamp01, luma } from './util';

/**
 * Grayscale — blends toward a fully desaturated image.
 * `amount`: 0 (unchanged) .. 1 (fully grayscale).
 */
export const grayscaleDefinition: EffectDefinition = {
  type: 'grayscale',
  category: 'color',
  params: {
    amount: { min: 0, max: 1, default: 1, description: 'Blend toward grayscale, 0 (none) to 1 (full).' },
  },
  op: {
    kind: 'color',
    glsl: (params) => `{
      float l = dot(color, vec3(0.299, 0.587, 0.114));
      color = clamp(mix(color, vec3(l), ${params.amount.toFixed(6)}), 0.0, 1.0);
    }`,
    applyToPixel: ([r, g, b], params) => {
      const l = luma(r, g, b);
      const mix = (c: number) => clamp01((c + (l - c) * params.amount) / 255) * 255;
      return [mix(r), mix(g), mix(b)];
    },
  },
};
