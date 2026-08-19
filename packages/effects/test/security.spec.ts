import { isEffectsError } from '@/errors';
import { assertNoRemoteCodeExecution, assertPipelineNotFull, EFFECT_SECURITY_LIMITS, validateAsset, validateParam, validateParams } from '@/security';

describe('validateParam', () => {
  const spec = { min: 0, max: 1, default: 0.5, description: 'test' };

  it('accepts an in-range value', () => {
    expect(() => validateParam('x', 0.5, spec)).not.toThrow();
  });

  it('rejects out-of-range values', () => {
    try {
      validateParam('x', 2, spec);
      throw new Error('expected throw');
    } catch (error) {
      expect(isEffectsError(error)).toBe(true);
      if (isEffectsError(error)) expect(error.code).toBe('RAVEN_EFFECT_INVALID_CONFIG');
    }
  });

  it('rejects NaN and non-finite values', () => {
    expect(() => validateParam('x', NaN, spec)).toThrow();
    expect(() => validateParam('x', Infinity, spec)).toThrow();
  });
});

describe('validateParams', () => {
  const specs = { value: { min: -1, max: 1, default: 0, description: 'x' } };

  it('fills in defaults for missing params', () => {
    expect(() => validateParams({}, specs)).not.toThrow();
  });

  it('rejects unknown parameters', () => {
    expect(() => validateParams({ bogus: 1 }, specs)).toThrow();
  });
});

describe('assertPipelineNotFull', () => {
  it('allows a pipeline under the cap', () => {
    expect(() => assertPipelineNotFull(0)).not.toThrow();
    expect(() => assertPipelineNotFull(EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH - 1)).not.toThrow();
  });

  it('rejects a pipeline at the cap', () => {
    expect(() => assertPipelineNotFull(EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH)).toThrow();
  });
});

describe('validateAsset', () => {
  it('accepts a small, allowed-type asset within dimension limits', () => {
    expect(() => validateAsset({ byteLength: 1024, mimeType: 'image/png', width: 512, height: 512 })).not.toThrow();
  });

  it('rejects an oversized asset', () => {
    expect(() => validateAsset({ byteLength: EFFECT_SECURITY_LIMITS.MAX_ASSET_BYTES + 1, mimeType: 'image/png' })).toThrow();
  });

  it('rejects a disallowed mime type (e.g. SVG, script risk)', () => {
    expect(() => validateAsset({ byteLength: 1024, mimeType: 'image/svg+xml' })).toThrow();
  });

  it('rejects oversized dimensions', () => {
    expect(() =>
      validateAsset({ byteLength: 1024, mimeType: 'image/png', width: EFFECT_SECURITY_LIMITS.MAX_ASSET_DIMENSION + 1 }),
    ).toThrow();
  });
});

describe('assertNoRemoteCodeExecution', () => {
  it('always throws RAVEN_EFFECT_PERMISSION_DENIED — Raven Effects never loads remote code', () => {
    try {
      assertNoRemoteCodeExecution('https://example.com/evil.js');
      throw new Error('expected throw');
    } catch (error) {
      expect(isEffectsError(error)).toBe(true);
      if (isEffectsError(error)) expect(error.code).toBe('RAVEN_EFFECT_PERMISSION_DENIED');
    }
  });
});
