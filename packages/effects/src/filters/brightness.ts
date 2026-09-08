import type { EffectDefinition } from '../types';
import { clamp01 } from './util';

/**
 * Brightness. An additive shift applied equally to every channel.
 * `value`: -1 (fully dark) to 1 (fully bright). 0 is no change.
 */
export const brightnessDefinition: EffectDefinition = {
  type: 'brightness',
  category: 'color',
  params: {
    value: { min: -1, max: 1, default: 0, description: 'Additive brightness shift, -1 (darker) to 1 (brighter). 0 = no change.' },
  },
  op: {
    kind: 'color',
    glsl: (params) => `color = clamp(color + vec3(${params.value.toFixed(6)}), 0.0, 1.0);`,
    applyToPixel: ([r, g, b], params) => {
      const shift = params.value * 255;
      return [clamp01((r + shift) / 255) * 255, clamp01((g + shift) / 255) * 255, clamp01((b + shift) / 255) * 255];
    },
  },
};
