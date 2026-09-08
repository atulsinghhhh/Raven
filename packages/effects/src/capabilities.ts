export type EngineKind = 'webgl2' | 'canvas2d' | 'passthrough';

export interface EffectsCapabilities {
  webgl2: boolean;
  offscreenCanvas: boolean;
  captureStream: boolean;
  requestVideoFrameCallback: boolean;
  /** The engine Raven Effects will actually use, given what this browser can do. */
  recommendedEngine: EngineKind;
}

/**
 * Works out what this runtime can genuinely do. Nothing here is assumed.
 *
 * `passthrough` means Raven Effects hands the original camera track
 * straight through, unmodified, instead of failing the call (§9/§31). A
 * video call has to keep working even where effects can't run at all.
 */
export function detectCapabilities(win: Window & typeof globalThis = globalThis as Window & typeof globalThis): EffectsCapabilities {
  const doc = (win as unknown as { document?: Document }).document;
  let webgl2 = false;
  try {
    const canvas = doc?.createElement('canvas');
    webgl2 = !!canvas?.getContext('webgl2');
  } catch {
    webgl2 = false;
  }

  const offscreenCanvas = typeof (win as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas === 'function';
  const captureStream =
    typeof (win as unknown as { HTMLCanvasElement?: { prototype?: { captureStream?: unknown } } }).HTMLCanvasElement?.prototype
      ?.captureStream === 'function';
  const requestVideoFrameCallback =
    typeof (win as unknown as { HTMLVideoElement?: { prototype?: { requestVideoFrameCallback?: unknown } } }).HTMLVideoElement?.prototype
      ?.requestVideoFrameCallback === 'function';

  let recommendedEngine: EngineKind = 'passthrough';
  if (captureStream && webgl2) {
    recommendedEngine = 'webgl2';
  } else if (captureStream) {
    recommendedEngine = 'canvas2d';
  }

  return { webgl2, offscreenCanvas, captureStream, requestVideoFrameCallback, recommendedEngine };
}
