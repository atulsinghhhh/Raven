import { corsOriginFor, isSdkBrowserSurface, parseCorsAllowlist } from './cors-policy';

const ALLOWLIST = ['https://app.ravenstack.online'];

describe('isSdkBrowserSurface', () => {
  it.each([
    '/v1/telemetry/events',
    '/v1/telemetry',
    '/v1/chat/conversations',
    '/v1/chat/messages/abc/reactions',
    '/v1/chat',
    '/v1/telemetry/events?connectionId=conn_1',
  ])('treats %s as an SDK surface', (url) => {
    expect(isSdkBrowserSurface(url)).toBe(true);
  });

  it.each([
    '/v1/rooms',
    '/v1/projects/p1/chat',
    '/v1/projects/p1/api-keys',
    '/v1/auth/login',
    '/v1/live-streams',
    '/health',
    '/',
  ])('does not treat %s as an SDK surface', (url) => {
    expect(isSdkBrowserSurface(url)).toBe(false);
  });

  it('does not match a path that merely starts with the same characters', () => {
    // `/v1/chatter` is not `/v1/chat`. Prefix matching without the
    // boundary check would hand a permissive origin to a route nobody
    // audited.
    expect(isSdkBrowserSurface('/v1/chatterbox')).toBe(false);
    expect(isSdkBrowserSurface('/v1/telemetry-internal')).toBe(false);
  });

  it('is safe on a missing url rather than throwing', () => {
    expect(isSdkBrowserSurface(undefined)).toBe(false);
  });
});

describe('corsOriginFor', () => {
  it('reflects any origin on an SDK surface, so every developer origin works', () => {
    // The whole point: a developer on localhost:5173 must not have to ask
    // Livqeno to add their port to a list.
    expect(corsOriginFor('/v1/telemetry/events', ALLOWLIST)).toBe(true);
    expect(corsOriginFor('/v1/chat/conversations', ALLOWLIST)).toBe(true);
  });

  it('keeps the allowlist for dashboard and session routes', () => {
    expect(corsOriginFor('/v1/projects/p1/api-keys', ALLOWLIST)).toBe(ALLOWLIST);
    expect(corsOriginFor('/v1/auth/login', ALLOWLIST)).toBe(ALLOWLIST);
  });

  it('stays permissive everywhere when CORS_ORIGIN is * (local dev)', () => {
    expect(corsOriginFor('/v1/auth/login', true)).toBe(true);
  });
});

describe('parseCorsAllowlist', () => {
  it('maps * to reflecting the caller', () => {
    expect(parseCorsAllowlist('*')).toBe(true);
    expect(parseCorsAllowlist(' * ')).toBe(true);
  });

  it('splits and trims a comma-separated list', () => {
    expect(parseCorsAllowlist('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('drops empty entries from a trailing comma rather than allowing ""', () => {
    // An empty string in the array would be compared against a real
    // Origin and never match, but it is also a silent config typo worth
    // not carrying forward.
    expect(parseCorsAllowlist('https://a.example,')).toEqual(['https://a.example']);
  });
});
