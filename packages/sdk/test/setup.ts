// jsdom (jest's browser-like test environment) doesn't implement
// TextEncoder/TextDecoder or any WebRTC media types — polyfill just enough
// for the SDK's own code (not livekit-client's full runtime) to import and
// run under test.
import { TextDecoder, TextEncoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
}
if (typeof (globalThis as { MediaStream?: unknown }).MediaStream === 'undefined') {
  class FakeMediaStream {
    getTracks(): MediaStreamTrack[] {
      return [];
    }
  }
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeMediaStream;
}
