import type { EffectsEngine, PipelineStats } from './types';

/**
 * Used when this runtime can't run effects at all (§9/§31: a call must keep
 * working). Returns the original camera track completely unmodified —
 * never a fake "processed" copy — so publish quality/perf is identical to
 * not having Raven Effects installed.
 */
export class PassthroughEngine implements EffectsEngine {
  readonly kind = 'passthrough' as const;
  private framesProcessed = 0;

  start(_video: HTMLVideoElement, sourceTrack: MediaStreamTrack): MediaStreamTrack {
    return sourceTrack;
  }

  rebuild(): void {
    // Nothing to recompute — there is no processing.
  }

  stop(): void {
    // Nothing owned by this engine — the caller still owns sourceTrack's lifecycle.
  }

  getStats(): PipelineStats {
    return { engine: this.kind, fps: 0, averageFrameTimeMs: 0, droppedFrames: 0, framesProcessed: this.framesProcessed };
  }
}
