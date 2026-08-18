import { Raven } from '../src/client';
import { RavenError } from '../src/errors';

describe('Raven', () => {
  it('throws synchronously when constructed without an apiKey', () => {
    // @ts-expect-error deliberately omitting the required field
    expect(() => new Raven({})).toThrow(RavenError);
  });

  it('exposes all documented resources', () => {
    const raven = new Raven({ apiKey: 'k' });

    expect(raven.projects).toBeDefined();
    expect(raven.tokens).toBeDefined();
    expect(raven.rooms).toBeDefined();
    expect(raven.rooms.participants).toBeDefined();
    expect(raven.connections).toBeDefined();
    expect(raven.errors).toBeDefined();
    expect(raven.metrics).toBeDefined();
    expect(raven.diagnostics).toBeDefined();
  });

  it('never exposes the API key through JSON.stringify or String() on the client itself', () => {
    const raven = new Raven({ apiKey: 'rvk_topsecret.value' });

    expect(JSON.stringify(raven)).not.toContain('topsecret');
    expect(String(raven)).not.toContain('topsecret');
  });

  it('does not automatically read process.env.RAVEN_API_KEY — apiKey must be passed explicitly', () => {
    const original = process.env.RAVEN_API_KEY;
    process.env.RAVEN_API_KEY = 'should-never-be-read-implicitly';
    try {
      // @ts-expect-error deliberately omitting the required field to prove there's no implicit fallback
      expect(() => new Raven({})).toThrow(RavenError);
    } finally {
      process.env.RAVEN_API_KEY = original;
    }
  });
});
