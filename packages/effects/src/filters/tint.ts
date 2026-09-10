import type { EffectDefinition } from '../types';
import { clamp01 } from './util';

/**
 * Tint. Shifts the green/magenta balance.
 * `value`: -1 (green) to 1 (magenta). 0 is no change.
 */
export const tintDefinition: EffectDefinition = {
  type: 'tint',
  category: 'color',
  params: {
    value: {
      min: -1,
      max: 1,
      default: 0,
      description: 'Green/magenta shift, -1 (green) to 1 (magenta). 0 = no change.',
    },
  },
  op: {
    kind: 'color',
    glsl: (params) => {
      const v = params.value * 0.15;
      return `color = clamp(color + vec3(${(v * 0.5).toFixed(6)}, ${(-v).toFixed(6)}, ${(v * 0.5).toFixed(6)}), 0.0, 1.0);`;
    },
    applyToPixel: ([r, g, b], params) => {
      const v = params.value * 0.15 * 255;
      return [clamp01((r + v * 0.5) / 255) * 255, clamp01((g - v) / 255) * 255, clamp01((b + v * 0.5) / 255) * 255];
    },
  },
};
