import type { EffectsEngine, PipelineStats } from './types';

/**
 * For when this runtime can't run effects at all (§9/§31, a call has to keep
 * working). Hands back the original camera track completely untouched.
 * Never a fake "processed" copy. Publish quality and performance are
 * identical to not having Raven Effects installed at all.
 */
export class PassthroughEngine implements EffectsEngine {
  readonly kind = 'passthrough' as const;
  private framesProcessed = 0;

  start(_video: HTMLVideoElement, sourceTrack: MediaStreamTrack): MediaStreamTrack {
    return sourceTrack;
  }

  rebuild(): void {
    // Nothing to recompute. There's no processing.
  }

  stop(): void {
    // This engine owns nothing. sourceTrack's lifecycle is still the
    // caller's problem.
  }

  getStats(): PipelineStats {
    return { engine: this.kind, fps: 0, averageFrameTimeMs: 0, droppedFrames: 0, framesProcessed: this.framesProcessed };
  }
}
