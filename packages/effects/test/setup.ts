// jsdom doesn't implement WebGL, OffscreenCanvas, captureStream(), or
// requestVideoFrameCallback. Tests exercise pipeline/filter/security logic
// against fakes (see test/helpers) rather than a real GPU — genuine GPU
// rendering is verified manually via examples/effects-demo in a real browser.
if (typeof globalThis.MediaStream === 'undefined') {
  class FakeMediaStream {
    private tracks: MediaStreamTrack[];
    constructor(tracks: MediaStreamTrack[] = []) {
      this.tracks = tracks;
    }
    getTracks(): MediaStreamTrack[] {
      return this.tracks;
    }
    getVideoTracks(): MediaStreamTrack[] {
      return this.tracks.filter((t) => t.kind === 'video');
    }
  }
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeMediaStream;
}
