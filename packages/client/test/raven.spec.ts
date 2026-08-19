import { Raven, createRaven } from '../src/index';

/**
 * `@corvidhq/client` is a facade — the interesting behaviour is which
 * clients it does and doesn't construct, and whether it fails early with
 * a useful message when the credential combination can't work.
 *
 * The underlying `@corvidhq/rtc` and `@corvidhq/chat` clients have their own
 * suites; nothing here re-tests them.
 */

// A syntactically valid RTC token. createRTCClient decodes (never
// verifies) it client-side, so it has to parse as a JWT.
function fakeRtcToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ video: { room: 'room_123' }, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

/**
 * @corvidhq/chat decodes (never verifies) the token client-side to fail fast
 * on an expired one, so the fixture needs the claims that decode
 * actually requires: `sub`, `pid`, and a numeric `exp`.
 */
function fakeChatToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'alice',
      pid: 'project-1',
      aud: 'raven-chat',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('Raven — credential validation', () => {
  it('refuses a token without an endpoint', () => {
    // Always a mistake, and catching it here beats a confusing connection
    // failure at join() time.
    expect(() => new Raven({ token: fakeRtcToken() })).toThrow(/both `token` and `endpoint`/);
  });

  it('refuses an endpoint without a token', () => {
    expect(() => new Raven({ endpoint: 'wss://sfu.example' })).toThrow(/both `token` and `endpoint`/);
  });

  it('refuses an instance with no credentials at all', () => {
    // Such an instance could do nothing; failing at construction is far
    // clearer than a null reference later.
    expect(() => new Raven({})).toThrow(/at least one credential/);
  });

  it('names all three valid shapes in the error, so the fix is obvious', () => {
    expect(() => new Raven({})).toThrow(/chatToken/);
  });
});

describe('Raven — RTC only', () => {
  const config = { token: fakeRtcToken(), endpoint: 'wss://sfu.example' };

  it('constructs an RTC client', () => {
    expect(new Raven(config).hasRtc).toBe(true);
  });

  it('constructs no chat client', () => {
    const raven = new Raven(config);
    expect(raven.hasChat).toBe(false);
    expect(raven.chat).toBeUndefined();
  });
});

describe('Raven — messaging only', () => {
  const config = { chatToken: fakeChatToken(), chatApiUrl: 'https://api.example' };

  it('constructs a chat client without any RTC credentials', () => {
    const raven = new Raven(config);
    expect(raven.hasChat).toBe(true);
    expect(raven.chat).toBeDefined();
  });

  it('constructs no RTC client', () => {
    const raven = new Raven(config);
    expect(raven.hasRtc).toBe(false);
    expect(raven.rtc).toBeUndefined();
  });

  it('refuses join() with an error that explains why, not a null reference', async () => {
    const raven = new Raven(config);
    await expect(raven.join('room_123')).rejects.toThrow(/no RTC credentials/);
  });

  it('points at the fix in the same message', async () => {
    const raven = new Raven(config);
    await expect(raven.join('room_123')).rejects.toThrow(/`token` and `endpoint`/);
  });

  it('disposes cleanly with nothing to tear down on the RTC side', async () => {
    await expect(new Raven(config).dispose()).resolves.toBeUndefined();
  });
});

describe('Raven — both planes', () => {
  const config = {
    token: fakeRtcToken(),
    endpoint: 'wss://sfu.example',
    chatToken: fakeChatToken(),
    chatApiUrl: 'https://api.example',
  };

  it('constructs both clients from one config', () => {
    const raven = new Raven(config);
    expect(raven.hasRtc).toBe(true);
    expect(raven.hasChat).toBe(true);
  });

  it('exposes the real underlying clients, not wrappers', () => {
    // The whole premise of this package: raven.chat IS a ChatClient, so
    // every method the chat docs describe is present without re-export.
    const raven = new Raven(config);
    expect(typeof raven.chat?.sendMessage).toBe('function');
    expect(typeof raven.chat?.connect).toBe('function');
    expect(typeof raven.rtc?.join).toBe('function');
  });

  it('reports no room before joining', () => {
    expect(new Raven(config).room).toBeUndefined();
  });
});

describe('createRaven', () => {
  it('is the same thing as the constructor', () => {
    const raven = createRaven({ chatToken: fakeChatToken(), chatApiUrl: 'https://api.example' });
    expect(raven).toBeInstanceOf(Raven);
  });
});
