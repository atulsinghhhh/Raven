import { __resetBootstrapForTests, bootstrapRavenNative } from '../src/internal/bootstrap';
import { __calls, __resetCalls } from './mocks/react-native-webrtc';

beforeEach(() => {
  __resetBootstrapForTests();
  __resetCalls();
});

describe('bootstrapRavenNative', () => {
  it('registers the WebRTC globals', () => {
    bootstrapRavenNative();
    expect(__calls.registerGlobals).toBe(1);
  });

  it('registers exactly once however many times it is called', () => {
    bootstrapRavenNative();
    bootstrapRavenNative();
    bootstrapRavenNative();

    // Register twice and you replace globals that live objects are already
    // holding references to. The kind of fault that only shows up on a
    // device, as tracks that quietly stop working after a reload.
    expect(__calls.registerGlobals).toBe(1);
  });
});

describe('base64 polyfill', () => {
  // `lib.dom` declares atob/btoa as required on globalThis, so an
  // intersection can't make them optional and `delete` won't typecheck.
  // Removing them is exactly what these tests need to fake a runtime
  // without them, and the indexed view is the honest way to say so.
  const globalRef = globalThis as unknown as {
    atob?: (input: string) => string;
    btoa?: (input: string) => string;
  };
  let originalAtob: typeof globalRef.atob;
  let originalBtoa: typeof globalRef.btoa;

  beforeEach(() => {
    originalAtob = globalRef.atob;
    originalBtoa = globalRef.btoa;
  });

  afterEach(() => {
    globalRef.atob = originalAtob;
    globalRef.btoa = originalBtoa;
  });

  it('installs atob/btoa when the runtime lacks them', () => {
    delete globalRef.atob;
    delete globalRef.btoa;

    bootstrapRavenNative();

    expect(typeof globalRef.atob).toBe('function');
    expect(typeof globalRef.btoa).toBe('function');
  });

  it('round-trips, so @corvidhq/chat can decode a token payload', () => {
    delete globalRef.atob;
    delete globalRef.btoa;
    bootstrapRavenNative();

    const payload = JSON.stringify({ sub: 'alice', pid: 'project_1', exp: 1787058553 });
    const encoded = globalRef.btoa!(payload);

    expect(globalRef.atob!(encoded)).toBe(payload);
    expect(JSON.parse(globalRef.atob!(encoded)).sub).toBe('alice');
  });

  it('decodes unpadded base64url-style input, which is what a JWT segment is', () => {
    delete globalRef.atob;
    bootstrapRavenNative();

    // A JWT payload segment turns up with its '=' padding stripped.
    expect(globalRef.atob!('YWJjZA')).toBe('abcd');
    expect(globalRef.atob!('YWJj')).toBe('abc');
  });

  it('leaves a runtime that already has them alone', () => {
    const existing = jest.fn(() => 'untouched');
    globalRef.atob = existing as unknown as typeof globalRef.atob;

    bootstrapRavenNative();

    // Replacing Hermes' native implementation would be slower and might
    // differ in the edge cases, all for nothing.
    expect(globalRef.atob).toBe(existing);
  });

  it('rejects input that is not base64 instead of returning nonsense', () => {
    delete globalRef.atob;
    bootstrapRavenNative();

    expect(() => globalRef.atob!('not valid !!')).toThrow(/not valid base64/);
  });
});
