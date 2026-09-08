import type { EffectDefinition } from '../types';
import { clamp01 } from './util';

/** The classic sepia colour matrix, same coefficients browsers use for CSS `filter: sepia()`. */
function sepiaMatrix(r: number, g: number, b: number): [number, number, number] {
  return [
    r * 0.393 + g * 0.769 + b * 0.189,
    r * 0.349 + g * 0.686 + b * 0.168,
    r * 0.272 + g * 0.534 + b * 0.131,
  ];
}

/**
 * Sepia. Blends toward a classic sepia tone.
 * `amount`: 0 (unchanged) to 1 (fully sepia).
 */
export const sepiaDefinition: EffectDefinition = {
  type: 'sepia',
  category: 'color',
  params: {
    amount: { min: 0, max: 1, default: 1, description: 'Blend toward sepia tone, 0 (none) to 1 (full).' },
  },
  op: {
    kind: 'color',
    glsl: (params) => `{
      vec3 sepia = vec3(
        dot(color, vec3(0.393, 0.769, 0.189)),
        dot(color, vec3(0.349, 0.686, 0.168)),
        dot(color, vec3(0.272, 0.534, 0.131))
      );
      color = clamp(mix(color, sepia, ${params.amount.toFixed(6)}), 0.0, 1.0);
    }`,
    applyToPixel: ([r, g, b], params) => {
      const [sr, sg, sb] = sepiaMatrix(r, g, b);
      const mix = (c: number, s: number) => clamp01((c + (s - c) * params.amount) / 255) * 255;
      return [mix(r, sr), mix(g, sg), mix(b, sb)];
    },
  },
};
