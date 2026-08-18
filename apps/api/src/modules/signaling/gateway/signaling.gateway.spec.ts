import { ConfigService } from '@nestjs/config';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { SignalingGateway } from './signaling.gateway';

/**
 * The heartbeat sweep runs on a real setInterval in production
 * (HEARTBEAT_INTERVAL_MS = 30s) — too slow to wait on in a test suite. So
 * here we call the sweep logic directly (private method, reached via a
 * cast) against mocked sockets, just to prove the ping/terminate
 * bookkeeping is correct. Wire-level connect/join/message behavior is
 * covered separately in test/signaling.e2e-spec.ts against real sockets.
 */
describe('SignalingGateway heartbeat', () => {
  function makeGateway(): { gateway: SignalingGateway; sessions: Map<unknown, ParticipantSession> } {
    const configService = { get: jest.fn(() => 100) } as unknown as ConfigService;
    const gateway = new SignalingGateway(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      configService,
    );
    // Reach into the private sessions map — see the comment above.
    const sessions = (gateway as unknown as { sessions: Map<unknown, ParticipantSession> }).sessions;
    return { gateway, sessions };
  }

  function makeSocket() {
    return { ping: jest.fn(), terminate: jest.fn() };
  }

  function makeSession(overrides: Partial<ParticipantSession>): ParticipantSession {
    return {
      connectionId: 'conn-1',
      participantId: 'alice',
      projectId: 'p1',
      roomId: 'r1',
      permissions: { join: true, subscribe: true, publish: false, publishAudio: false, publishVideo: false, publishData: false },
      socket: {} as never,
      joinedRoom: false,
      joinedAt: null,
      isAlive: true,
      messageTimestamps: [],
      ...overrides,
    };
  }

  it('pings a live connection and marks it not-yet-confirmed', () => {
    const { gateway, sessions } = makeGateway();
    const socket = makeSocket();
    const session = makeSession({ isAlive: true, socket: socket as never });
    sessions.set(socket, session);

    (gateway as unknown as { runHeartbeat(): void }).runHeartbeat();

    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(session.isAlive).toBe(false);
  });

  it('terminates a connection that never answered the previous ping', () => {
    const { gateway, sessions } = makeGateway();
    const socket = makeSocket();
    const session = makeSession({ isAlive: false, socket: socket as never }); // missed the last pong

    sessions.set(socket, session);

    (gateway as unknown as { runHeartbeat(): void }).runHeartbeat();

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(socket.ping).not.toHaveBeenCalled();
  });

  it('does not affect other live connections when terminating a stale one', () => {
    const { gateway, sessions } = makeGateway();
    const staleSocket = makeSocket();
    const liveSocket = makeSocket();
    sessions.set(staleSocket, makeSession({ isAlive: false, socket: staleSocket as never, participantId: 'stale' }));
    sessions.set(liveSocket, makeSession({ isAlive: true, socket: liveSocket as never, participantId: 'live' }));

    (gateway as unknown as { runHeartbeat(): void }).runHeartbeat();

    expect(staleSocket.terminate).toHaveBeenCalledTimes(1);
    expect(liveSocket.ping).toHaveBeenCalledTimes(1);
    expect(liveSocket.terminate).not.toHaveBeenCalled();
  });
});
