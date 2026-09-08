// jsdom implements none of WebGL, OffscreenCanvas, captureStream() or
// requestVideoFrameCallback. So these tests drive pipeline, filter and
// security logic against fakes (see test/helpers), not a real GPU.
// Actual GPU rendering gets checked by hand through examples/effects-demo
// in a real browser.
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
