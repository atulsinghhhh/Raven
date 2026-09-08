import type { EffectDefinition } from '../types';
import { clamp01 } from './util';

/**
 * Temperature. Shifts the red/blue balance, i.e. warm/cool white balance.
 * `value`: -1 (cooler, bluer) to 1 (warmer, more orange). 0 is no change.
 */
export const temperatureDefinition: EffectDefinition = {
  type: 'temperature',
  category: 'color',
  params: {
    value: { min: -1, max: 1, default: 0, description: 'White-balance shift, -1 (cooler) to 1 (warmer). 0 = no change.' },
  },
  op: {
    kind: 'color',
    glsl: (params) => {
      const v = params.value * 0.18;
      return `color = clamp(color + vec3(${v.toFixed(6)}, 0.0, ${(-v).toFixed(6)}), 0.0, 1.0);`;
    },
    applyToPixel: ([r, g, b], params) => {
      const shift = params.value * 0.18 * 255;
      return [clamp01((r + shift) / 255) * 255, g, clamp01((b - shift) / 255) * 255];
    },
  },
};
