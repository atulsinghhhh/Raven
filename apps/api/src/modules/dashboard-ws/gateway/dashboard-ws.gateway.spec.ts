import { DashboardWsError } from '../dashboard-ws-error';
import { DashboardWsErrorCode } from '../dashboard-ws.constants';
import { DashboardWsGateway } from './dashboard-ws.gateway';
import { DashboardWsSession } from './dashboard-ws-session.interface';

function makeSocket() {
  return {
    pause: jest.fn(),
    resume: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    terminate: jest.fn(),
    ping: jest.fn(),
    readyState: 1, // WebSocket.OPEN
  };
}

function makeRequest(overrides: { token?: string; origin?: string; ip?: string } = {}) {
  const query = overrides.token !== undefined ? `?token=${encodeURIComponent(overrides.token)}` : '';
  return {
    url: `/v1/dashboard/ws${query}`,
    headers: { origin: overrides.origin ?? 'https://app.example.com' },
    socket: { remoteAddress: overrides.ip ?? '203.0.113.1' },
  } as unknown as import('http').IncomingMessage;
}

function makeGateway(overrides: {
  verify?: jest.Mock;
  subscribe?: jest.Mock;
  isAllowed?: jest.Mock;
  connectionRateLimit?: jest.Mock;
} = {}) {
  const verify = overrides.verify ?? jest.fn();
  const subscribe = overrides.subscribe ?? jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined));
  const isAllowed = overrides.isAllowed ?? jest.fn().mockResolvedValue(true);
  const connectionRateLimitAllowed = overrides.connectionRateLimit ?? jest.fn().mockResolvedValue(true);
  const onEvent = jest.fn().mockReturnValue(jest.fn());

  const gateway = new DashboardWsGateway(
    { verify } as never, // DashboardWsTokenService
    { subscribe, onEvent, getSubscribedChannelCount: jest.fn().mockReturnValue(0) } as never, // DashboardEventsService
    { isAllowed } as never, // ProjectOriginService
    { isAllowed: connectionRateLimitAllowed } as never, // DashboardWsConnectionRateLimitService
  );

  const sessions = (gateway as unknown as { sessions: Map<unknown, DashboardWsSession> }).sessions;
  return { gateway, sessions, verify, subscribe, isAllowed, connectionRateLimitAllowed, onEvent };
}

const VALID_CLAIMS = { jti: 'dwt_1', sub: 'user-1', pid: 'project-1', iat: 0, exp: Math.floor(Date.now() / 1000) + 300 };

describe('DashboardWsGateway.handleConnection', () => {
  it('accepts a valid token, subscribes to the token project channel, and sends a connected frame', async () => {
    const { gateway, sessions, subscribe } = makeGateway({ verify: jest.fn().mockResolvedValue(VALID_CLAIMS) });
    const socket = makeSocket();

    await gateway.handleConnection(socket as never, makeRequest({ token: 'a-valid-token' }));

    expect(subscribe).toHaveBeenCalledWith('project-1');
    expect(sessions.size).toBe(1);
    const [session] = Array.from(sessions.values());
    expect(session.projectId).toBe('project-1');
    expect(session.userId).toBe('user-1');
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(String(socket.send.mock.calls[0][0])).toContain('"type":"connected"');
    expect(socket.resume).toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('rejects a connection with an invalid token and never subscribes to any project channel', async () => {
    const { gateway, sessions, subscribe } = makeGateway({
      verify: jest.fn().mockRejectedValue(new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'bad token')),
    });
    const socket = makeSocket();

    await gateway.handleConnection(socket as never, makeRequest({ token: 'garbage' }));

    expect(subscribe).not.toHaveBeenCalled();
    expect(sessions.size).toBe(0);
    expect(socket.close).toHaveBeenCalledWith(4801, DashboardWsErrorCode.INVALID_TOKEN);
  });

  it('rejects a connection with an expired token using the token-expired close code', async () => {
    const { gateway } = makeGateway({
      verify: jest.fn().mockRejectedValue(new DashboardWsError(DashboardWsErrorCode.TOKEN_EXPIRED, 'expired')),
    });
    const socket = makeSocket();

    await gateway.handleConnection(socket as never, makeRequest({ token: 'expired' }));

    expect(socket.close).toHaveBeenCalledWith(4840, DashboardWsErrorCode.TOKEN_EXPIRED);
  });

  it('rejects a connection with a revoked token using the auth-failed close code', async () => {
    const { gateway } = makeGateway({
      verify: jest.fn().mockRejectedValue(new DashboardWsError(DashboardWsErrorCode.TOKEN_REVOKED, 'revoked')),
    });
    const socket = makeSocket();

    await gateway.handleConnection(socket as never, makeRequest({ token: 'revoked' }));

    expect(socket.close).toHaveBeenCalledWith(4801, DashboardWsErrorCode.TOKEN_REVOKED);
  });

  it('rejects a connection whose origin is not allowed for the token project, without ever subscribing', async () => {
    const { gateway, subscribe, isAllowed } = makeGateway({
      verify: jest.fn().mockResolvedValue(VALID_CLAIMS),
      isAllowed: jest.fn().mockResolvedValue(false),
    });
    const socket = makeSocket();

    await gateway.handleConnection(socket as never, makeRequest({ token: 'a-valid-token', origin: 'https://evil.example.com' }));

    expect(isAllowed).toHaveBeenCalledWith('project-1', 'https://evil.example.com');
    expect(subscribe).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(4803, DashboardWsErrorCode.ORIGIN_NOT_ALLOWED);
  });

  it('rejects a connection over the per-IP rate limit before even verifying the token', async () => {
    const verify = jest.fn();
    const { gateway } = makeGateway({ verify, connectionRateLimit: jest.fn().mockResolvedValue(false) });
    const socket = makeSocket();

    await gateway.handleConnection(socket as never, makeRequest({ token: 'irrelevant' }));

    expect(verify).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(4829, DashboardWsErrorCode.RATE_LIMITED);
  });

  describe('project isolation', () => {
    it('scopes each connection to exactly the project in its own token, with no cross-talk between connections', async () => {
      const verify = jest
        .fn()
        .mockResolvedValueOnce({ ...VALID_CLAIMS, sub: 'user-a', pid: 'project-a' })
        .mockResolvedValueOnce({ ...VALID_CLAIMS, sub: 'user-b', pid: 'project-b' });
      const { gateway, sessions, subscribe } = makeGateway({ verify });

      const socketA = makeSocket();
      const socketB = makeSocket();
      await gateway.handleConnection(socketA as never, makeRequest({ token: 'token-a' }));
      await gateway.handleConnection(socketB as never, makeRequest({ token: 'token-b' }));

      expect(subscribe).toHaveBeenNthCalledWith(1, 'project-a');
      expect(subscribe).toHaveBeenNthCalledWith(2, 'project-b');

      const byUser = new Map(Array.from(sessions.values()).map((s) => [s.userId, s.projectId]));
      expect(byUser.get('user-a')).toBe('project-a');
      expect(byUser.get('user-b')).toBe('project-b');
    });
  });
});

describe('DashboardWsGateway.getMetrics (Phase 6H)', () => {
  it('counts an accepted connection toward totalConnections but not rejectionsByReason', async () => {
    const { gateway } = makeGateway({ verify: jest.fn().mockResolvedValue(VALID_CLAIMS) });

    await gateway.handleConnection(makeSocket() as never, makeRequest({ token: 'a-valid-token' }));

    expect(gateway.getMetrics().totalConnections).toBe(1);
    expect(gateway.getMetrics().rejectionsByReason).toEqual({});
  });

  it('tallies a rejection under its DashboardWsErrorCode, without touching totalConnections', async () => {
    const { gateway } = makeGateway({
      verify: jest.fn().mockRejectedValue(new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'bad token')),
    });

    await gateway.handleConnection(makeSocket() as never, makeRequest({ token: 'garbage' }));

    expect(gateway.getMetrics()).toMatchObject({
      totalConnections: 0,
      rejectionsByReason: { [DashboardWsErrorCode.INVALID_TOKEN]: 1 },
    });
  });

  it('accumulates separate reasons independently across repeated rejections', async () => {
    const verify = jest
      .fn()
      .mockRejectedValueOnce(new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'bad'))
      .mockRejectedValueOnce(new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'bad again'))
      .mockRejectedValueOnce(new DashboardWsError(DashboardWsErrorCode.TOKEN_EXPIRED, 'expired'));
    const { gateway } = makeGateway({ verify });

    await gateway.handleConnection(makeSocket() as never, makeRequest({ token: 'a' }));
    await gateway.handleConnection(makeSocket() as never, makeRequest({ token: 'b' }));
    await gateway.handleConnection(makeSocket() as never, makeRequest({ token: 'c' }));

    expect(gateway.getMetrics().rejectionsByReason).toEqual({
      [DashboardWsErrorCode.INVALID_TOKEN]: 2,
      [DashboardWsErrorCode.TOKEN_EXPIRED]: 1,
    });
  });

  it('accepted connections keep accumulating across multiple connects', async () => {
    const { gateway } = makeGateway({ verify: jest.fn().mockResolvedValue(VALID_CLAIMS) });

    await gateway.handleConnection(makeSocket() as never, makeRequest({ token: 'a' }));
    await gateway.handleConnection(makeSocket() as never, makeRequest({ token: 'b' }));

    expect(gateway.getMetrics().totalConnections).toBe(2);
  });
});

describe('DashboardWsGateway.handleDisconnect', () => {
  it('releases the project channel subscription and removes the session', async () => {
    const { gateway, sessions } = makeGateway({ verify: jest.fn().mockResolvedValue(VALID_CLAIMS) });
    const socket = makeSocket();
    await gateway.handleConnection(socket as never, makeRequest({ token: 'a-valid-token' }));
    expect(sessions.size).toBe(1);
    const [session] = Array.from(sessions.values());
    const unsubscribe = session.unsubscribe as jest.Mock;

    await gateway.handleDisconnect(socket as never);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(sessions.size).toBe(0);
  });

  it('is a no-op for a socket the gateway never authenticated', async () => {
    const { gateway } = makeGateway();
    await expect(gateway.handleDisconnect(makeSocket() as never)).resolves.toBeUndefined();
  });
});

/**
 * Same rationale as SignalingGateway's heartbeat spec: the sweep runs on a
 * real setInterval in production (DASHBOARD_WS_HEARTBEAT_INTERVAL_MS =
 * 25s), too slow to wait on in a test suite, so the sweep logic is called
 * directly here against mocked sockets.
 */
describe('DashboardWsGateway heartbeat', () => {
  function sessionOf(overrides: Partial<DashboardWsSession> = {}): DashboardWsSession {
    return {
      connectionId: 'dcn_1',
      projectId: 'project-1',
      userId: 'user-1',
      tokenId: 'dwt_1',
      tokenExpiresAt: Date.now() + 60_000,
      socket: makeSocket() as never,
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      isAlive: true,
      connectedAt: new Date(),
      ...overrides,
    };
  }

  it('pings a live connection and marks it not-yet-confirmed', async () => {
    const { gateway, sessions } = makeGateway();
    const socket = makeSocket();
    sessions.set(socket, sessionOf({ isAlive: true, socket: socket as never }));

    await (gateway as unknown as { runHeartbeat(): Promise<void> }).runHeartbeat();

    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(sessions.get(socket)!.isAlive).toBe(false);
  });

  it('terminates a connection that never answered the previous ping, and releases its subscription', async () => {
    const { gateway, sessions } = makeGateway();
    const socket = makeSocket();
    const unsubscribe = jest.fn().mockResolvedValue(undefined);
    sessions.set(socket, sessionOf({ isAlive: false, socket: socket as never, unsubscribe }));

    await (gateway as unknown as { runHeartbeat(): Promise<void> }).runHeartbeat();

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(socket.ping).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(sessions.has(socket)).toBe(false);
  });

  it('closes a connection whose token has expired, with the token-expired close code', async () => {
    const { gateway, sessions } = makeGateway();
    const socket = makeSocket();
    sessions.set(socket, sessionOf({ isAlive: true, socket: socket as never, tokenExpiresAt: Date.now() - 1000 }));

    await (gateway as unknown as { runHeartbeat(): Promise<void> }).runHeartbeat();

    expect(socket.close).toHaveBeenCalledWith(4840, 'token expired');
    expect(sessions.has(socket)).toBe(false);
  });

  it('does not affect other live connections when terminating a stale one', async () => {
    const { gateway, sessions } = makeGateway();
    const staleSocket = makeSocket();
    const liveSocket = makeSocket();
    sessions.set(staleSocket, sessionOf({ isAlive: false, socket: staleSocket as never, connectionId: 'stale' }));
    sessions.set(liveSocket, sessionOf({ isAlive: true, socket: liveSocket as never, connectionId: 'live' }));

    await (gateway as unknown as { runHeartbeat(): Promise<void> }).runHeartbeat();

    expect(staleSocket.terminate).toHaveBeenCalledTimes(1);
    expect(liveSocket.ping).toHaveBeenCalledTimes(1);
    expect(liveSocket.terminate).not.toHaveBeenCalled();
  });
});

/**
 * Phase 5C: delivering what ConnectionsService/RoomsService publish onto
 * DashboardEventsService back out to the local sockets scoped to that
 * project. afterInit() is what wires the subscription in production; here
 * it's called explicitly (it never runs on its own in these unit tests)
 * to capture the handler DashboardEventsService.onEvent() was given, then
 * that handler is invoked directly to simulate a Redis-delivered envelope.
 */
describe('DashboardWsGateway — event delivery (Phase 5C)', () => {
  function deliverEnvelope(onEvent: jest.Mock, envelope: { projectId: string; event: Record<string, unknown> }) {
    const handler = onEvent.mock.calls[0][0] as (envelope: unknown) => void;
    handler(envelope);
  }

  it('delivers a published event to every local socket scoped to that project', async () => {
    const { gateway, onEvent } = makeGateway({ verify: jest.fn().mockResolvedValue(VALID_CLAIMS) });
    gateway.afterInit();
    const socket = makeSocket();
    await gateway.handleConnection(socket as never, makeRequest({ token: 'a-valid-token' }));
    socket.send.mockClear(); // drop the 'connected' frame from the connect step above

    deliverEnvelope(onEvent, {
      projectId: 'project-1',
      event: { type: 'connection.state_changed', connectionId: 'conn_abc', roomId: 'room-1', state: 'CONNECTED' },
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      type: 'connection.state_changed',
      connectionId: 'conn_abc',
      roomId: 'room-1',
      state: 'CONNECTED',
    });
  });

  it('delivers notification.created (Phase 5F) to every socket for the project — no per-user routing at the WS layer, by design', async () => {
    // Two sockets, two different users, same project: the gateway only
    // scopes by projectId, never by which recipient a notification row
    // belongs to. Each client is expected to refetch its own unread list
    // over REST — GET /v1/projects/:id/notifications, scoped to the
    // caller's own session — which is where per-user scoping actually
    // happens. See notifications.service.spec.ts for that boundary.
    const verify = jest
      .fn()
      .mockResolvedValueOnce({ ...VALID_CLAIMS, sub: 'user-a', pid: 'project-1' })
      .mockResolvedValueOnce({ ...VALID_CLAIMS, sub: 'user-b', pid: 'project-1' });
    const { gateway, onEvent } = makeGateway({ verify });
    gateway.afterInit();
    const socketA = makeSocket();
    const socketB = makeSocket();
    await gateway.handleConnection(socketA as never, makeRequest({ token: 'token-a' }));
    await gateway.handleConnection(socketB as never, makeRequest({ token: 'token-b' }));
    socketA.send.mockClear();
    socketB.send.mockClear();

    deliverEnvelope(onEvent, { projectId: 'project-1', event: { type: 'notification.created' } });

    expect(socketA.send).toHaveBeenCalledTimes(1);
    expect(socketB.send).toHaveBeenCalledTimes(1);
    // No resource fields — see dashboard-ws-events.ts's doc comment on
    // NotificationCreatedEvent for why this frame is deliberately empty
    // beyond `type`.
    expect(JSON.parse(socketA.send.mock.calls[0][0])).toEqual({ type: 'notification.created' });
  });

  it('project isolation: never delivers an event to a socket scoped to a different project', async () => {
    const verify = jest
      .fn()
      .mockResolvedValueOnce({ ...VALID_CLAIMS, sub: 'user-a', pid: 'project-a' })
      .mockResolvedValueOnce({ ...VALID_CLAIMS, sub: 'user-b', pid: 'project-b' });
    const { gateway, onEvent } = makeGateway({ verify });
    gateway.afterInit();
    const socketA = makeSocket();
    const socketB = makeSocket();
    await gateway.handleConnection(socketA as never, makeRequest({ token: 'token-a' }));
    await gateway.handleConnection(socketB as never, makeRequest({ token: 'token-b' }));
    socketA.send.mockClear();
    socketB.send.mockClear();

    deliverEnvelope(onEvent, {
      projectId: 'project-a',
      event: { type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' },
    });

    expect(socketA.send).toHaveBeenCalledTimes(1);
    expect(socketB.send).not.toHaveBeenCalled();
  });

  it('never delivers to a socket that already disconnected', async () => {
    const { gateway, onEvent } = makeGateway({ verify: jest.fn().mockResolvedValue(VALID_CLAIMS) });
    gateway.afterInit();
    const socket = makeSocket();
    await gateway.handleConnection(socket as never, makeRequest({ token: 'a-valid-token' }));
    await gateway.handleDisconnect(socket as never);
    socket.send.mockClear();

    deliverEnvelope(onEvent, {
      projectId: 'project-1',
      event: { type: 'connection.state_changed', connectionId: 'conn_abc', roomId: 'room-1', state: 'DISCONNECTED' },
    });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('is a silent no-op when no local socket holds the published project at all', () => {
    const { gateway, onEvent } = makeGateway();
    gateway.afterInit();

    expect(() =>
      deliverEnvelope(onEvent, {
        projectId: 'project-nobody-is-watching',
        event: { type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' },
      }),
    ).not.toThrow();
  });

  it('a duplicate/replayed event delivered twice is just delivered twice — no dedup, no corruption, by design (the client coalesces)', async () => {
    const { gateway, onEvent } = makeGateway({ verify: jest.fn().mockResolvedValue(VALID_CLAIMS) });
    gateway.afterInit();
    const socket = makeSocket();
    await gateway.handleConnection(socket as never, makeRequest({ token: 'a-valid-token' }));
    socket.send.mockClear();

    const envelope = {
      projectId: 'project-1',
      event: { type: 'connection.state_changed', connectionId: 'conn_abc', roomId: 'room-1', state: 'CONNECTED' },
    };
    deliverEnvelope(onEvent, envelope);
    deliverEnvelope(onEvent, envelope);

    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(socket.send.mock.calls[0][0]).toEqual(socket.send.mock.calls[1][0]);
  });
});
