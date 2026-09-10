import { filters, FILTER_DEFINITIONS } from '@/filters/index';
import { isEffectsError } from '@/errors';

describe('filters factories', () => {
  it('fills in documented defaults when no params are given', () => {
    const cfg = filters.brightness();
    expect(cfg.params.value).toBe(FILTER_DEFINITIONS.brightness.params.value.default);
  });

  it('accepts a value within the documented range', () => {
    const cfg = filters.brightness({ value: 0.2 });
    expect(cfg.params.value).toBe(0.2);
  });

  it('rejects a value outside the documented range', () => {
    expect(() => filters.brightness({ value: 5 })).toThrow();
  });

  it('rejects invalid saturation, exposure, and blur values', () => {
    expect(() => filters.saturation({ value: -1 })).toThrow();
    expect(() => filters.exposure({ stops: 10 })).toThrow();
    expect(() => filters.blur({ radius: -1 })).toThrow();
  });

  it('every FILTER_DEFINITIONS entry has at least one param spec and a matching op kind', () => {
    for (const [type, definition] of Object.entries(FILTER_DEFINITIONS)) {
      expect(definition.type).toBe(type);
      expect(Object.keys(definition.params).length).toBeGreaterThan(0);
      expect(['color', 'spatial']).toContain(definition.op.kind);
    }
  });
});

describe('color op math (spot checks against the documented formulas)', () => {
  it('brightness(0) leaves a pixel unchanged', () => {
    const [r, g, b] =
      FILTER_DEFINITIONS.brightness.op.kind === 'color'
        ? FILTER_DEFINITIONS.brightness.op.applyToPixel([100, 150, 200], { value: 0 })
        : [0, 0, 0];
    expect([r, g, b]).toEqual([100, 150, 200]);
  });

  it('grayscale(1) fully desaturates a colored pixel (r ≈ g ≈ b)', () => {
    const op = FILTER_DEFINITIONS.grayscale.op;
    if (op.kind !== 'color') throw new Error('expected a color op');
    const [r, g, b] = op.applyToPixel([200, 50, 10], { amount: 1 });
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
  });

  it('saturation(0) is equivalent to grayscale(1); both collapse to luma', () => {
    const sat = FILTER_DEFINITIONS.saturation.op;
    const gray = FILTER_DEFINITIONS.grayscale.op;
    if (sat.kind !== 'color' || gray.kind !== 'color') throw new Error('expected color ops');
    const pixel: [number, number, number] = [180, 90, 30];
    const a = sat.applyToPixel(pixel, { value: 0 });
    const b = gray.applyToPixel(pixel, { amount: 1 });
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(a[1]).toBeCloseTo(b[1], 5);
    expect(a[2]).toBeCloseTo(b[2], 5);
  });

  it('exposure(0) leaves a pixel unchanged; exposure(1) doubles it (before clamping)', () => {
    const op = FILTER_DEFINITIONS.exposure.op;
    if (op.kind !== 'color') throw new Error('expected a color op');
    expect(op.applyToPixel([50, 50, 50], { stops: 0 })).toEqual([50, 50, 50]);
    const [r] = op.applyToPixel([50, 50, 50], { stops: 1 });
    expect(r).toBeCloseTo(100, 5);
  });

  it('every color op clamps output to [0, 255]', () => {
    for (const definition of Object.values(FILTER_DEFINITIONS)) {
      if (definition.op.kind !== 'color') continue;
      const extreme = Object.fromEntries(Object.entries(definition.params).map(([name, spec]) => [name, spec.max]));
      const [r, g, b] = definition.op.applyToPixel([255, 255, 255], extreme);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('unknown filter type', () => {
  it('rejects unsupported filter types with RAVEN_EFFECT_UNSUPPORTED', async () => {
    const { makeFilterFactory } = await import('@/filters/index');
    try {
      makeFilterFactory('doesNotExist');
      throw new Error('expected throw');
    } catch (error) {
      expect(isEffectsError(error)).toBe(true);
      if (isEffectsError(error)) expect(error.code).toBe('RAVEN_EFFECT_UNSUPPORTED');
    }
  });
});
