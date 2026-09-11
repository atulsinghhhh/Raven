type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Drives a per-frame callback off `requestVideoFrameCallback` where it
 * exists, with a watchdog that falls back to `requestAnimationFrame`.
 *
 * `requestVideoFrameCallback` existing on the prototype is no guarantee it
 * ever fires. Some embedded and automated browser contexts expose the API
 * and never present a frame through it. (Found this the hard way, testing
 * this pipeline against a canvas-`captureStream()` source in an automated
 * Chrome instance.) So rather than trust feature detection alone,
 * this scheduler arms a short watchdog on the very first callback and
 * switches permanently to `requestAnimationFrame` if nothing fires. That's
 * what stops the pipeline quietly rendering zero frames in an environment
 * where the faster API is present but useless.
 */
export class FrameScheduler {
  private readonly video: RvfcVideo;
  private readonly onFrame: (nowMs: number) => void;
  private stopped = false;
  private useRvfc = true;
  private generation = 0;
  private handle?: number;
  private watchdog?: ReturnType<typeof setTimeout>;

  constructor(video: HTMLVideoElement, onFrame: (nowMs: number) => void) {
    this.video = video;
    this.onFrame = onFrame;
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.watchdog !== undefined) clearTimeout(this.watchdog);
    if (this.handle !== undefined) {
      if (this.useRvfc && this.video.cancelVideoFrameCallback) {
        this.video.cancelVideoFrameCallback(this.handle);
      } else {
        cancelAnimationFrame(this.handle);
      }
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const gen = this.generation;

    if (this.useRvfc && typeof this.video.requestVideoFrameCallback === 'function') {
      this.watchdog = setTimeout(() => {
        if (this.stopped || gen !== this.generation) return;
        this.useRvfc = false;
        this.generation++;
        this.scheduleNext();
      }, 750);

      this.handle = this.video.requestVideoFrameCallback((now) => {
        if (this.stopped || gen !== this.generation) return; // stale; a fallback switch already happened
        if (this.watchdog !== undefined) clearTimeout(this.watchdog);
        this.onFrame(now);
        this.scheduleNext();
      });
    } else {
      this.handle = requestAnimationFrame(() => {
        if (this.stopped || gen !== this.generation) return;
        this.onFrame(typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.scheduleNext();
      });
    }
  }
}
