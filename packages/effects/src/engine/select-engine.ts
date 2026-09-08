import { detectCapabilities, type EffectsCapabilities } from '../capabilities';
import { EffectsError } from '../errors';
import { Canvas2DEngine } from './canvas2d-engine';
import { PassthroughEngine } from './passthrough-engine';
import type { EffectsEngine } from './types';
import { WebGLEngine } from './webgl-engine';

/**
 * Picks the best engine this runtime genuinely supports (§8/§9: prefer GPU,
 * degrade gracefully, never fail the call). `onError` is how a caller hears
 * about a mid-stream processing failure without the video pipeline dying.
 */
export function selectEngine(onError?: (error: EffectsError) => void, capabilities: EffectsCapabilities = detectCapabilities()): EffectsEngine {
  switch (capabilities.recommendedEngine) {
    case 'webgl2':
      return new WebGLEngine(onError);
    case 'canvas2d':
      return new Canvas2DEngine(onError);
    default:
      return new PassthroughEngine();
  }
}
