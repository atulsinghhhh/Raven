import { getBrowserSupportDetails, isBrowserSupported } from '../src/browser-support';

describe('getBrowserSupportDetails / isBrowserSupported', () => {
  it('returns a stable shape, and names what jsdom is missing rather than throwing', () => {
    // jsdom has WebSocket but neither RTCPeerConnection nor
    // navigator.mediaDevices, and the SDK's test setup deliberately does
    // not polyfill them globally — so this environment is genuinely
    // unsupported, and saying so is the point. A detector that threw when
    // a capability was absent would be useless exactly where it matters.
    const details = getBrowserSupportDetails();

    expect(details.supported).toBe(false);
    expect(details.missing).toContain('RTCPeerConnection');
    expect(details.missing).toContain('navigator.mediaDevices.getUserMedia');
    expect(details.missing).not.toContain('WebSocket');
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
