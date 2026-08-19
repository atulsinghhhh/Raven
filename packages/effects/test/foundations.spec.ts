import { isEffectsError } from '@/errors';
import { createFaceDetector } from '@/foundations/face-detector';
import { createBackgroundProcessor } from '@/foundations/background';
import { createAROverlay } from '@/foundations/ar';
import { beauty, beautySmoothDefinition } from '@/foundations/beauty';

describe('FaceDetector (§15 — planned, not implemented)', () => {
  it('reports unsupported rather than pretending to detect faces', async () => {
    const detector = createFaceDetector();
    expect(detector.isSupported()).toBe(false);
    await expect(detector.detect()).rejects.toMatchObject({ code: 'RAVEN_EFFECT_UNSUPPORTED' });
  });
});

describe('BackgroundProcessor (§17 — planned, no segmentation model)', () => {
  it('reports unsupported rather than compositing a fake background', () => {
    const processor = createBackgroundProcessor();
    expect(processor.isSupported()).toBe(false);
    expect(() => processor.configure({ mode: 'blur' })).toThrow();
  });
});

describe('AROverlay (§18 — planned, depends on face tracking)', () => {
  it('reports unsupported and refuses to attach an overlay', () => {
    const overlay = createAROverlay(createFaceDetector());
    expect(overlay.isSupported()).toBe(false);
    try {
      overlay.attach({ id: 'a', image: {} as unknown as HTMLImageElement }, { id: 'anchor', landmarkTarget: 'noseTip' });
      throw new Error('expected throw');
    } catch (error) {
      expect(isEffectsError(error)).toBe(true);
      if (isEffectsError(error)) expect(error.code).toBe('RAVEN_EFFECT_UNSUPPORTED');
    }
  });
});

describe('beauty.smooth (§16 — production, basic whole-frame smoothing)', () => {
  it('builds a valid config with the documented default', () => {
    const cfg = beauty.smooth();
    expect(cfg.type).toBe('beautySmooth');
    expect(cfg.params.amount).toBe(beautySmoothDefinition.params.amount.default);
  });

  it('rejects an out-of-range amount', () => {
    expect(() => beauty.smooth({ amount: 5 })).toThrow();
  });

  it('applyToImageData actually blurs pixels (not a no-op) at amount > 0', () => {
    // 4x4 checkerboard: sharp edges before, softened after a real blur pass.
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const on = (x + y) % 2 === 0;
        const idx = (y * width + x) * 4;
        data[idx] = on ? 255 : 0;
        data[idx + 1] = on ? 255 : 0;
        data[idx + 2] = on ? 255 : 0;
        data[idx + 3] = 255;
      }
    }
    const imageData = { width, height, data } as unknown as ImageData;
    const before = Uint8ClampedArray.from(data);
    if (beautySmoothDefinition.op.kind !== 'spatial') throw new Error('expected a spatial op');
    beautySmoothDefinition.op.applyToImageData(imageData, { amount: 1 });
    expect(Array.from(data)).not.toEqual(Array.from(before));
    // A center pixel should move away from pure black/white toward gray once blurred.
    const centerIdx = (1 * width + 1) * 4;
    expect(data[centerIdx]).toBeGreaterThan(0);
    expect(data[centerIdx]).toBeLessThan(255);
  });
});
