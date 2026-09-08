import type { EffectDefinition } from '../types';
import { clamp01 } from './util';

/**
 * Exposure. Multiplicative brightness, in photographic stops.
 * `stops`: -2 to 2, 0 is no change. Every +1 stop doubles brightness
 * (2^stops).
 */
export const exposureDefinition: EffectDefinition = {
  type: 'exposure',
  category: 'color',
  params: {
    stops: { min: -2, max: 2, default: 0, description: 'Exposure adjustment in stops, -2 to 2. Each +1 doubles brightness. 0 = no change.' },
  },
  op: {
    kind: 'color',
    glsl: (params) => `color = clamp(color * pow(2.0, ${params.stops.toFixed(6)}), 0.0, 1.0);`,
    applyToPixel: ([r, g, b], params) => {
      const factor = Math.pow(2, params.stops);
      const adj = (c: number) => clamp01((c / 255) * factor) * 255;
      return [adj(r), adj(g), adj(b)];
    },
  },
};
