import { decodeSessionEmail } from '@/lib/decode-session';

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

describe('decodeSessionEmail', () => {
  it('extracts the email from a well-formed JWT payload', () => {
    const token = makeToken({ sub: 'user-1', email: 'dev@example.com', jti: 'abc' });
    expect(decodeSessionEmail(token)).toBe('dev@example.com');
  });

  it('returns undefined for a malformed token (not enough JWT segments)', () => {
    expect(decodeSessionEmail('not-a-jwt')).toBeUndefined();
  });

  it('returns undefined when the payload has no email field', () => {
    const token = makeToken({ sub: 'user-1' });
    expect(decodeSessionEmail(token)).toBeUndefined();
  });

  it('returns undefined for invalid base64/JSON in the payload segment', () => {
    expect(decodeSessionEmail('aaa.!!!not-base64!!!.bbb')).toBeUndefined();
  });

  it('never throws — this is display-only and a bad token must not crash the layout', () => {
    expect(() => decodeSessionEmail('')).not.toThrow();
    expect(() => decodeSessionEmail('a.b')).not.toThrow();
  });
});
