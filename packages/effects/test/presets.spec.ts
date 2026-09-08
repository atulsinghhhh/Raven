import { presets } from '@/presets';
import { FILTER_DEFINITIONS } from '@/filters/index';

describe('presets', () => {
  it('every preset composes only existing filter types (no duplicated pixel math)', () => {
    for (const preset of Object.values(presets)) {
      const configs = preset();
      expect(configs.length).toBeGreaterThan(0);
      for (const config of configs) {
        expect(FILTER_DEFINITIONS[config.type]).toBeDefined();
      }
    }
  });

  it('cinematic composes contrast, saturation, and temperature in that order (per the spec diagram)', () => {
    const configs = presets.cinematic();
    expect(configs.map((c) => c.type)).toEqual(['contrast', 'saturation', 'temperature']);
  });

  it('every preset call returns fresh config objects (no shared mutable state across pipelines)', () => {
    const a = presets.vivid();
    const b = presets.vivid();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    a[0].params.value = 999;
    expect(b[0].params.value).not.toBe(999);
  });
});
