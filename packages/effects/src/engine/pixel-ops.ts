import type { ColorOp, ColorOpParams } from '../types';

/** Applies one color op to every pixel of an ImageData buffer in place — the Canvas2D fallback's per-pixel path. */
export function applyColorOpToImageData(imageData: ImageData, op: ColorOp, params: ColorOpParams): void {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = op.applyToPixel([data[i], data[i + 1], data[i + 2]], params);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** Rolling window used by every engine to report honest, measured fps/latency — never a hardcoded number. */
export class FrameTimer {
  private readonly windowSize: number;
  private intervals: number[] = [];
  private processingTimes: number[] = [];
  private lastFrameAt?: number;
  private dropped = 0;
  private processed = 0;
  private readonly expectedIntervalMs: number;

  constructor(targetFrameRate: number, windowSize = 60) {
    this.windowSize = windowSize;
    this.expectedIntervalMs = 1000 / Math.max(1, targetFrameRate);
  }

  recordFrame(nowMs: number, processingTimeMs: number): void {
    if (this.lastFrameAt !== undefined) {
      const interval = nowMs - this.lastFrameAt;
      this.push(this.intervals, interval);
      if (interval > this.expectedIntervalMs * 1.5) {
        this.dropped += 1;
      }
    }
    this.lastFrameAt = nowMs;
    this.push(this.processingTimes, processingTimeMs);
    this.processed += 1;
  }

  private push(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > this.windowSize) arr.shift();
  }

  get fps(): number {
    if (this.intervals.length === 0) return 0;
    const avgInterval = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    return avgInterval > 0 ? 1000 / avgInterval : 0;
  }

  get averageFrameTimeMs(): number {
    if (this.processingTimes.length === 0) return 0;
    return this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
  }

  get droppedFrames(): number {
    return this.dropped;
  }

  get framesProcessed(): number {
    return this.processed;
  }
}
