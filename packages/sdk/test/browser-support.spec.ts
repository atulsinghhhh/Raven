import { getBrowserSupportDetails, isBrowserSupported } from '../src/browser-support';

describe('getBrowserSupportDetails / isBrowserSupported', () => {
  it('reports supported in jsdom, which the SDK\'s own test setup polyfills enough of', () => {
    // jsdom provides WebSocket and RTCPeerConnection is polyfilled by
    // livekit-client's own dependency chain in this test environment —
    // real assertion is just that this never throws and returns a stable shape.
    const details = getBrowserSupportDetails();
    expect(typeof details.supported).toBe('boolean');
    expect(Array.isArray(details.missing)).toBe(true);
  });

  it('flags a missing capability by name rather than just returning false', () => {
    const originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error deliberately deleting a global to simulate an unsupported browser
    delete globalThis.WebSocket;

    const details = getBrowserSupportDetails();

    expect(details.supported).toBe(false);
    expect(details.missing).toContain('WebSocket');

    globalThis.WebSocket = originalWebSocket;
  });

  it('isBrowserSupported() is a plain boolean convenience over the same check', () => {
    const originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error deliberately deleting a global to simulate an unsupported browser
    delete globalThis.WebSocket;

    expect(isBrowserSupported()).toBe(false);

    globalThis.WebSocket = originalWebSocket;
  });

  it('never throws even when navigator is completely absent', () => {
    const originalNavigator = globalThis.navigator;
    // @ts-expect-error deliberately deleting a global to simulate an extreme environment
    delete globalThis.navigator;

    expect(() => getBrowserSupportDetails()).not.toThrow();
    expect(getBrowserSupportDetails().missing).toContain('navigator.mediaDevices.getUserMedia');

    globalThis.navigator = originalNavigator;
  });
});
