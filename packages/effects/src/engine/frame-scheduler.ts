type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Drives a per-frame callback off `requestVideoFrameCallback` when
 * available, with a watchdog fallback to `requestAnimationFrame`.
 *
 * `requestVideoFrameCallback` being a function on the prototype does not
 * guarantee it actually fires — some embedded/automated browser contexts
 * expose the API but never present a frame through it (observed while
 * testing this pipeline against a canvas-`captureStream()` source in an
 * automated Chrome instance). Rather than trust feature detection alone,
 * this scheduler arms a short watchdog on the very first callback and
 * permanently switches to `requestAnimationFrame` if it never fires —
 * this is what keeps the pipeline from silently rendering zero frames in
 * an environment where the "faster" API is present but non-functional.
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
        if (this.stopped || gen !== this.generation) return; // stale — a fallback switch already happened
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
