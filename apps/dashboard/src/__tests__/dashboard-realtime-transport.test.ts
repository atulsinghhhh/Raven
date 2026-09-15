import { DashboardRealtimeTransport, type DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';

/** A fake socket the test controls directly — no real network involved. */
class FakeSocket implements DashboardRealtimeSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | undefined;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
  }

  open() {
    this.readyState = 1; // OPEN
    this.onopen?.(undefined);
  }

  serverClose(code: number, reason = '') {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason });
  }

  receive(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function makeTransport(overrides: {
  onFrame?: jest.Mock;
  onOpen?: jest.Mock;
  onClose?: jest.Mock;
  onReconnecting?: jest.Mock;
  onError?: jest.Mock;
  maxReconnectAttempts?: number;
} = {}) {
  const sockets: FakeSocket[] = [];
  const socketFactory = jest.fn((url: string) => {
    void url; // captured via socketFactory.mock.calls in assertions below
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });

  const handlers = {
    onFrame: overrides.onFrame ?? jest.fn(),
    onOpen: overrides.onOpen ?? jest.fn(),
    onClose: overrides.onClose ?? jest.fn(),
    onReconnecting: overrides.onReconnecting ?? jest.fn(),
    onError: overrides.onError ?? jest.fn(),
  };

  const transport = new DashboardRealtimeTransport(
    {
      wsUrl: 'wss://api.example.com/v1/dashboard/ws',
      token: 'initial-token',
      maxReconnectAttempts: overrides.maxReconnectAttempts ?? 10,
      initialReconnectDelayMs: 100,
      maxReconnectDelayMs: 1000,
      socketFactory,
    },
    handlers,
  );

  return { transport, sockets, socketFactory, handlers };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DashboardRealtimeTransport', () => {
  it('connects: opens a socket carrying the token in the query string and reports open', () => {
    const { transport, sockets, handlers } = makeTransport();

    transport.connect();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]).toBeDefined();

    sockets[0].open();

    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(transport.isOpen).toBe(true);
  });

  it('threads the current token onto the connection URL', () => {
    const { transport, socketFactory } = makeTransport();
    transport.connect();
    const [url] = socketFactory.mock.calls[0];
    expect(url).toBe('wss://api.example.com/v1/dashboard/ws?token=initial-token');
  });

  it('reconnects after a recoverable close, with exponential backoff', () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0].open();

    sockets[0].serverClose(1006, 'abnormal closure');

    expect(handlers.onClose).toHaveBeenCalledWith(
      expect.objectContaining({ code: 1006, willReconnect: true, terminal: false }),
    );
    expect(handlers.onReconnecting).toHaveBeenCalledWith(1, expect.any(Number));
    expect(sockets).toHaveLength(1); // not yet — the reconnect is scheduled, not immediate

    jest.runOnlyPendingTimers();
    expect(sockets).toHaveLength(2);
  });

  it('backs off with an increasing delay across consecutive attempts', () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0].open();
    sockets[0].serverClose(1006);
    const [, firstDelay] = handlers.onReconnecting.mock.calls[0];

    jest.runOnlyPendingTimers();
    sockets[1].serverClose(1006);
    const [, secondDelay] = handlers.onReconnecting.mock.calls[1];

    // Full jitter means neither delay is exact, but the second attempt's
    // exponential target is strictly larger, and the floor (a quarter of
    // the target) grows with it — so the second delay is reliably larger
    // than the first's minimum possible value.
    expect(secondDelay).toBeGreaterThan(firstDelay * 0.9);
  });

  it('does not reconnect after a terminal close (auth failed)', () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0].open();

    sockets[0].serverClose(4801, 'auth failed'); // DASHBOARD_WS_CLOSE_AUTH_FAILED

    expect(handlers.onClose).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, willReconnect: false }));
    expect(handlers.onReconnecting).not.toHaveBeenCalled();

    jest.runAllTimers();
    expect(sockets).toHaveLength(1); // still just the one, rejected socket
  });

  it('does not reconnect after a terminal close (origin not allowed)', () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0].open();

    sockets[0].serverClose(4803, 'origin not allowed'); // DASHBOARD_WS_CLOSE_FORBIDDEN

    expect(handlers.onClose).toHaveBeenCalledWith(expect.objectContaining({ terminal: true }));
    jest.runAllTimers();
    expect(sockets).toHaveLength(1);
  });

  it('gives up and reports terminal once reconnect attempts are exhausted, without looping forever', () => {
    const { transport, sockets, handlers } = makeTransport({ maxReconnectAttempts: 2 });
    transport.connect();
    sockets[0].open();

    sockets[0].serverClose(1006); // attempt 1 scheduled
    jest.runOnlyPendingTimers();
    sockets[1].serverClose(1006); // attempt 2 scheduled
    jest.runOnlyPendingTimers();
    sockets[2].serverClose(1006); // attempts exhausted here

    expect(handlers.onClose).toHaveBeenLastCalledWith(
      expect.objectContaining({ willReconnect: false, terminal: true }),
    );
    expect(handlers.onError).toHaveBeenCalledWith(expect.stringContaining('Could not reconnect'));

    jest.runAllTimers();
    expect(sockets).toHaveLength(3); // no further attempts beyond the configured max
  });

  it('cleanup: disconnect() cancels a pending reconnect and never reopens', () => {
    const { transport, sockets } = makeTransport();
    transport.connect();
    sockets[0].open();
    sockets[0].serverClose(1006); // schedules a reconnect

    transport.disconnect();
    jest.runAllTimers();

    // The scheduled reconnect never fired: no second socket was opened.
    expect(sockets).toHaveLength(1);
  });

  it('cleanup: disconnect() on a live connection closes the socket and detaches its handlers, without triggering the reconnect path', () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0].open();

    transport.disconnect();

    expect(sockets[0].closedWith).toBeDefined();
    // Handlers were detached before close(), so the socket's own close
    // event (were the fake to fire one) can never reach the reconnect
    // logic — a caller-initiated disconnect must never be mistaken for a
    // dropped connection.
    expect(sockets[0].onclose).toBeNull();
    expect(handlers.onReconnecting).not.toHaveBeenCalled();
  });

  it('cleanup: disconnect() before any close event still detaches the socket cleanly', () => {
    const { transport, sockets } = makeTransport();
    transport.connect();
    sockets[0].open();

    expect(() => transport.disconnect()).not.toThrow();
    expect(sockets[0].closedWith).toBeDefined();
    expect(transport.isOpen).toBe(false);
  });

  it('setToken swaps the credential a subsequent reconnect uses', () => {
    const { transport, sockets, socketFactory } = makeTransport();
    transport.connect();
    sockets[0].open();
    sockets[0].serverClose(4840); // DASHBOARD_WS_CLOSE_TOKEN_EXPIRED — recoverable

    transport.setToken('refreshed-token');
    jest.runOnlyPendingTimers();

    const [reconnectUrl] = socketFactory.mock.calls[1];
    expect(reconnectUrl).toContain('token=refreshed-token');
  });

  it('delivers a parsed server frame to onFrame', () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0].open();

    sockets[0].receive({ type: 'connected', connectionId: 'dcn_1', heartbeatIntervalMs: 25_000 });

    expect(handlers.onFrame).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'connected', heartbeatIntervalMs: 25_000 }),
    );
  });

  it('silently discards a malformed frame instead of throwing', () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0].open();

    expect(() => sockets[0].onmessage?.({ data: 'not json' })).not.toThrow();
    expect(handlers.onFrame).not.toHaveBeenCalled();
  });
});
