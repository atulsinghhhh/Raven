import type { EngineKind } from '../capabilities';
import type { EffectInstance } from '../types';

export interface PipelineStats {
  engine: EngineKind;
  fps: number;
  averageFrameTimeMs: number;
  droppedFrames: number;
  framesProcessed: number;
}

/**
 * An EffectsEngine turns a live `HTMLVideoElement` into a processed
 * `MediaStreamTrack`.
 *
 * `EffectsPipeline` owns *what* to render, i.e. the effect list. An engine
 * owns *how*: WebGL2, Canvas2D, or passthrough. Swapping engines never
 * changes the public pipeline API. capabilities.ts covers how one gets
 * picked.
 */
export interface EffectsEngine {
  readonly kind: EngineKind;
  /** Starts the frame loop and returns the live output track right away. It fills in as frames render. */
  start(video: HTMLVideoElement, sourceTrack: MediaStreamTrack, getEffects: () => EffectInstance[]): MediaStreamTrack;
  /** The effect list changed (add, remove, update, reorder, enable, disable). Recompute whatever the engine cached. */
  rebuild(): void;
  stop(): void;
  getStats(): PipelineStats;
}
