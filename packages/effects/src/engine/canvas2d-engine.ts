import { EffectsError } from '../errors';
import type { EffectInstance } from '../types';
import { applyColorOpToImageData, FrameTimer } from './pixel-ops';
import type { EffectsEngine, PipelineStats } from './types';

/**
 * CPU fallback for browsers without WebGL2 — real pixel-buffer processing
 * (getImageData/putImageData), not a CSS-filter stand-in, so every filter
 * behaves identically to the GPU path. Slower per §9's "degrade
 * gracefully" contract, never faked.
 */
export class Canvas2DEngine implements EffectsEngine {
  readonly kind = 'canvas2d' as const;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private video?: HTMLVideoElement;
  private getEffects?: () => EffectInstance[];
  private handle?: number;
  private stopped = false;
  private timer: FrameTimer;
  private onError?: (error: EffectsError) => void;

  constructor(onError?: (error: EffectsError) => void) {
    this.timer = new FrameTimer(30);
    this.onError = onError;
  }

  start(video: HTMLVideoElement, sourceTrack: MediaStreamTrack, getEffects: () => EffectInstance[]): MediaStreamTrack {
    const settings = sourceTrack.getSettings();
    const width = settings.width ?? video.videoWidth ?? 1280;
    const height = settings.height ?? video.videoHeight ?? 720;
    const frameRate = settings.frameRate ?? 30;
    this.timer = new FrameTimer(frameRate);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new EffectsError('RAVEN_EFFECT_UNSUPPORTED', 'Canvas 2D context is unavailable in this environment.');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.video = video;
    this.getEffects = getEffects;

    const stream = canvas.captureStream(frameRate);
    const [outputTrack] = stream.getVideoTracks();
    this.scheduleNextFrame();
    return outputTrack;
  }

  rebuild(): void {
    // Stateless per frame — getEffects() is re-read every render, nothing cached to invalidate.
  }

  stop(): void {
    this.stopped = true;
    if (this.handle !== undefined) {
      const video = this.video as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | undefined;
      if (video?.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(this.handle);
      } else {
        cancelAnimationFrame(this.handle);
      }
    }
  }

  getStats(): PipelineStats {
    return {
      engine: this.kind,
      fps: this.timer.fps,
      averageFrameTimeMs: this.timer.averageFrameTimeMs,
      droppedFrames: this.timer.droppedFrames,
      framesProcessed: this.timer.framesProcessed,
    };
  }

  private scheduleNextFrame(): void {
    if (this.stopped || !this.video) return;
    const video = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number) => void) => number };
    const runFrame = (now: number) => {
      if (this.stopped) return;
      const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        this.renderFrame();
      } catch (error) {
        this.onError?.(
          error instanceof EffectsError
            ? error
            : new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'Canvas2D effect frame failed to render.', error),
        );
      }
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
      this.timer.recordFrame(now, elapsed);
      this.scheduleNextFrame();
    };
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.handle = video.requestVideoFrameCallback(runFrame);
    } else {
      this.handle = requestAnimationFrame(() => runFrame(typeof performance !== 'undefined' ? performance.now() : Date.now()));
    }
  }

  private renderFrame(): void {
    if (!this.ctx || !this.canvas || !this.video) return;
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const effects = (this.getEffects?.() ?? []).filter((e) => e.enabled);
    if (effects.length === 0) return;

    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    for (const effect of effects) {
      if (effect.op.kind === 'color') {
        applyColorOpToImageData(imageData, effect.op, effect.params);
      } else {
        effect.op.applyToImageData(imageData, effect.params);
      }
    }
    this.ctx.putImageData(imageData, 0, 0);
  }
}
