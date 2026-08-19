import type { EffectDefinition } from '../types';
import { clamp01 } from './util';

/**
 * Contrast — scales each channel around mid-gray (0.5).
 * `value`: -1 (flat gray) .. 1 (maximum contrast); 0 = no change.
 */
export const contrastDefinition: EffectDefinition = {
  type: 'contrast',
  category: 'color',
  params: {
    value: { min: -1, max: 1, default: 0, description: 'Contrast adjustment around mid-gray, -1 (flat) to 1 (max contrast). 0 = no change.' },
  },
  op: {
    kind: 'color',
    glsl: (params) => `color = clamp((color - 0.5) * (1.0 + ${params.value.toFixed(6)}) + 0.5, 0.0, 1.0);`,
    applyToPixel: ([r, g, b], params) => {
      const factor = 1 + params.value;
      const adj = (c: number) => clamp01((((c / 255 - 0.5) * factor + 0.5))) * 255;
      return [adj(r), adj(g), adj(b)];
    },
  },
};
