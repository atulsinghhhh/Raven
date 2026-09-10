import { detectCapabilities } from '@/capabilities';

function fakeWindow(overrides: {
  webgl2?: boolean;
  captureStream?: boolean;
  offscreenCanvas?: boolean;
  requestVideoFrameCallback?: boolean;
}): Window & typeof globalThis {
  const canvas = {
    getContext: (kind: string) => (kind === 'webgl2' && overrides.webgl2 ? {} : null),
  };
  return {
    document: { createElement: () => canvas },
    OffscreenCanvas: overrides.offscreenCanvas ? function () {} : undefined,
    HTMLCanvasElement: { prototype: { captureStream: overrides.captureStream ? function () {} : undefined } },
    HTMLVideoElement: {
      prototype: { requestVideoFrameCallback: overrides.requestVideoFrameCallback ? function () {} : undefined },
    },
  } as unknown as Window & typeof globalThis;
}

describe('detectCapabilities', () => {
  it('recommends webgl2 when both WebGL2 and captureStream are available', () => {
    const caps = detectCapabilities(fakeWindow({ webgl2: true, captureStream: true }));
    expect(caps.recommendedEngine).toBe('webgl2');
    expect(caps.webgl2).toBe(true);
  });

  it('falls back to canvas2d when captureStream exists but WebGL2 does not', () => {
    const caps = detectCapabilities(fakeWindow({ webgl2: false, captureStream: true }));
    expect(caps.recommendedEngine).toBe('canvas2d');
  });

  it('falls back to passthrough when captureStream is unavailable (call must keep working, §9/§31)', () => {
    const caps = detectCapabilities(fakeWindow({ webgl2: true, captureStream: false }));
    expect(caps.recommendedEngine).toBe('passthrough');
  });

  it('never throws even if canvas creation itself fails', () => {
    const brokenWindow = {
      document: {
        createElement: () => {
          throw new Error('no canvas here');
        },
      },
    } as unknown as Window & typeof globalThis;
    expect(() => detectCapabilities(brokenWindow)).not.toThrow();
    expect(detectCapabilities(brokenWindow).recommendedEngine).toBe('passthrough');
  });
});
