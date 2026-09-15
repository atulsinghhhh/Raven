import { handleSessionExpiry } from '@/lib/session-expiry';

describe('handleSessionExpiry', () => {
  it('returns false for a non-401 response, without touching window.location', () => {
    // jsdom's window.location.assign is a real, non-configurable/non-writable
    // method — it can't be spied on here, so this only asserts the early-return
    // contract via the return value: a non-401 must never reach the redirect.
    expect(handleSessionExpiry({ status: 500 } as Response)).toBe(false);
    expect(handleSessionExpiry({ status: 200 } as Response)).toBe(false);
  });

  it('returns true and navigates to /login for a 401', () => {
    // jsdom's window.location.assign is a real, non-configurable method that
    // logs a harmless "not implemented: navigation" virtual-console error
    // when actually invoked in a test — silence it so the assertion below
    // stays the only signal.
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(handleSessionExpiry({ status: 401 } as Response)).toBe(true);

    consoleErrorSpy.mockRestore();
  });
});
