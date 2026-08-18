// jsdom doesn't implement TextEncoder/TextDecoder or MediaStream — same
// polyfill packages/sdk's own tests use, needed transitively here too.
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
