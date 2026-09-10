import {
  isLoopbackOrigin,
  isOriginAllowed,
  normalizeOrigin,
  normalizeOriginList,
  type ProjectOriginPolicy,
} from './origin-policy';

const policy = (allowedOrigins: string[], allowLocalhostOrigins = true): ProjectOriginPolicy => ({
  allowedOrigins,
  allowLocalhostOrigins,
});

describe('normalizeOrigin', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['HTTPS://Example.COM', 'https://example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['https://app.example.com:8443', 'https://app.example.com:8443'],
    // Default ports are dropped so :443 and bare compare equal.
    ['https://example.com:443', 'https://example.com'],
    ['http://example.com:80', 'http://example.com'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it.each([
    ['*', 'a wildcard is not an origin'],
    ['https://*.example.com', 'wildcards would grant every present and future subdomain'],
    ['null', 'the literal null origin'],
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['example.com', 'no scheme'],
    ['ftp://example.com', 'non-http scheme'],
    ['ws://example.com', 'websocket scheme is not an origin'],
    ['javascript:alert(1)', 'not a fetchable scheme'],
    ['https://example.com/app', 'a path is not part of an origin'],
    ['https://example.com?x=1', 'a query is not part of an origin'],
    ['https://example.com#f', 'a fragment is not part of an origin'],
    ['https://user:pw@example.com', 'userinfo must not be smuggled in'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeOrigin(input)).toBeUndefined();
  });
});

describe('isLoopbackOrigin', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:8080', 'https://localhost'])('accepts %s', (origin) => {
    expect(isLoopbackOrigin(origin)).toBe(true);
  });

  it.each(['https://example.com', 'https://localhost.attacker.com', 'https://notlocalhost'])('rejects %s', (origin) => {
    // `localhost.attacker.com` is the classic near-miss: it ends up on a
    // real DNS name the attacker controls.
    expect(isLoopbackOrigin(origin)).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  it('allows a request with no Origin at all (server-side caller)', () => {
    expect(isOriginAllowed(undefined, policy(['https://app-a.com']))).toBe(true);
    expect(isOriginAllowed(null, policy(['https://app-a.com']))).toBe(true);
  });

  it('rejects a malformed Origin rather than guessing', () => {
    expect(isOriginAllowed('not-an-origin', policy(['https://app-a.com']))).toBe(false);
    expect(isOriginAllowed('*', policy(['https://app-a.com']))).toBe(false);
  });

  it('is open while unconfigured, so existing projects keep working', () => {
    // Deliberate migration behaviour: every pre-existing project has an
    // empty list, and defaulting those to deny would break live apps.
    expect(isOriginAllowed('https://anything.example', policy([]))).toBe(true);
  });

  it('enforces the list once a project configures its first origin', () => {
    const p = policy(['https://app-a.com']);
    expect(isOriginAllowed('https://app-a.com', p)).toBe(true);
    expect(isOriginAllowed('https://evil.example', p)).toBe(false);
  });

  it('matches on the normalized form, so :443 and a trailing slash still match', () => {
    const p = policy(['https://app-a.com']);
    expect(isOriginAllowed('https://app-a.com:443', p)).toBe(true);
    expect(isOriginAllowed('HTTPS://APP-A.COM', p)).toBe(true);
  });

  it('does not treat a configured origin as covering its subdomains', () => {
    const p = policy(['https://example.com']);
    expect(isOriginAllowed('https://app.example.com', p)).toBe(false);
  });

  it('does not let a suffix or prefix collision through', () => {
    const p = policy(['https://app-a.com']);
    expect(isOriginAllowed('https://app-a.com.evil.example', p)).toBe(false);
    expect(isOriginAllowed('https://notapp-a.com', p)).toBe(false);
  });

  it('distinguishes scheme and port', () => {
    const p = policy(['https://app-a.com']);
    expect(isOriginAllowed('http://app-a.com', p)).toBe(false);
    expect(isOriginAllowed('https://app-a.com:8443', p)).toBe(false);
  });

  describe('localhost development mechanism', () => {
    it('permits any loopback port alongside configured production origins', () => {
      // The point of §3: a developer on :5173 must not have to register it,
      // and configuring production domains must not break local work.
      const p = policy(['https://app-a.com']);
      expect(isOriginAllowed('http://localhost:3000', p)).toBe(true);
      expect(isOriginAllowed('http://localhost:5173', p)).toBe(true);
      expect(isOriginAllowed('http://localhost:8080', p)).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:3001', p)).toBe(true);
    });

    it('can be switched off per project without touching the origin list', () => {
      const p = policy(['https://app-a.com'], false);
      expect(isOriginAllowed('http://localhost:3000', p)).toBe(false);
      expect(isOriginAllowed('https://app-a.com', p)).toBe(true);
    });

    it('is loopback-only, never a wildcard', () => {
      const p = policy(['https://app-a.com']);
      expect(isOriginAllowed('https://localhost.evil.example', p)).toBe(false);
      expect(isOriginAllowed('https://evil.example', p)).toBe(false);
    });
  });

  describe('multi-tenant isolation (spec §2)', () => {
    // Each project's list is consulted on its own. The project itself is
    // taken from the caller's token, never from the request, so there is
    // nothing here a caller could point at another tenant.
    const projectA = policy(['http://localhost:3000', 'https://app-a.com']);
    const projectB = policy(['http://localhost:5173', 'https://app-b.com']);

    it("does not let project A's origin reach project B", () => {
      expect(isOriginAllowed('https://app-a.com', projectB)).toBe(false);
    });

    it("does not let project B's origin reach project A", () => {
      expect(isOriginAllowed('https://app-b.com', projectA)).toBe(false);
    });

    it('still admits each project on its own origin', () => {
      expect(isOriginAllowed('https://app-a.com', projectA)).toBe(true);
      expect(isOriginAllowed('https://app-b.com', projectB)).toBe(true);
    });

    it("does not let one project's configuration widen another's, even for loopback ports", () => {
      // Both happen to allow loopback, so :5173 works for A as well — that
      // is the localhost rule, not A inheriting B's list. With localhost
      // off, A gets nothing of B's.
      const strictA = policy(['https://app-a.com'], false);
      expect(isOriginAllowed('http://localhost:5173', strictA)).toBe(false);
    });
  });
});

describe('normalizeOriginList', () => {
  it('normalizes, dedupes and reports what was not an origin', () => {
    const result = normalizeOriginList([
      'https://app.example.com',
      'https://app.example.com/',
      'HTTPS://APP.EXAMPLE.COM',
      'https://*.example.com',
      'nonsense',
    ]);

    expect(result.origins).toEqual(['https://app.example.com']);
    expect(result.invalid).toEqual(['https://*.example.com', 'nonsense']);
  });

  it('accepts an empty list, which means unconfigured', () => {
    expect(normalizeOriginList([])).toEqual({ origins: [], invalid: [] });
  });
});
