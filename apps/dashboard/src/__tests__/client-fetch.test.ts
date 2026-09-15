import { errorMessage, readJson } from '@/lib/client-fetch';

describe('readJson', () => {
  it('resolves the parsed body for a well-formed response', async () => {
    const response = { json: async () => ({ id: '1', name: 'demo' }) } as Response;
    await expect(readJson(response)).resolves.toEqual({ id: '1', name: 'demo' });
  });

  it('resolves undefined instead of throwing when the body is not valid JSON', async () => {
    const response = {
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response;
    await expect(readJson(response)).resolves.toBeUndefined();
  });
});

describe('errorMessage', () => {
  it('extracts message off a parsed {code, message} error body', () => {
    expect(errorMessage({ code: 'VALIDATION_ERROR', message: 'name is required' }, 'fallback')).toBe(
      'name is required',
    );
  });

  it('falls back when the payload is undefined', () => {
    expect(errorMessage(undefined, 'Could not save changes')).toBe('Could not save changes');
  });

  it('falls back when the payload has no string message field', () => {
    expect(errorMessage({}, 'fallback')).toBe('fallback');
    expect(errorMessage({ message: 42 }, 'fallback')).toBe('fallback');
    expect(errorMessage('not an object', 'fallback')).toBe('fallback');
    expect(errorMessage(null, 'fallback')).toBe('fallback');
  });
});
