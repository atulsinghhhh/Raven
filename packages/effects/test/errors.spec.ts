import { EffectsError, isEffectsError } from '@/errors';

describe('EffectsError', () => {
  it('carries a stable code and name', () => {
    const error = new EffectsError('RAVEN_EFFECT_INVALID_CONFIG', 'bad value');
    expect(error.code).toBe('RAVEN_EFFECT_INVALID_CONFIG');
    expect(error.name).toBe('EffectsError');
    expect(error.message).toBe('bad value');
  });

  it('is recognized by isEffectsError, and rejects other errors', () => {
    expect(isEffectsError(new EffectsError('RAVEN_EFFECT_UNSUPPORTED', 'x'))).toBe(true);
    expect(isEffectsError(new Error('plain'))).toBe(false);
    expect(isEffectsError(null)).toBe(false);
  });
});
