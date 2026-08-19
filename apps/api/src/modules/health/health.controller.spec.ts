import { HealthController } from './health.controller';
import { checkLiveKitHttp, checkStunBinding } from './dependency-checks.util';

jest.mock('./dependency-checks.util');

const mockCheckLiveKitHttp = checkLiveKitHttp as jest.Mock;
const mockCheckStunBinding = checkStunBinding as jest.Mock;

function fakeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { ping: jest.Mock };
  let redis: { ping: jest.Mock };
  let signalingGateway: { getMetrics: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    prisma = { ping: jest.fn().mockResolvedValue(undefined) };
    redis = { ping: jest.fn().mockResolvedValue(undefined) };
    signalingGateway = {
      getMetrics: jest.fn().mockReturnValue({ activeConnections: 0, activeRooms: 0, activeParticipants: 0 }),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'livekit.internalUrl') return 'http://livekit:7880';
        if (key === 'turn.internalHost') return 'coturn';
        if (key === 'turn.port') return 3478;
        return undefined;
      }),
    };
    mockCheckLiveKitHttp.mockReset().mockResolvedValue(true);
    mockCheckStunBinding.mockReset().mockResolvedValue(true);

    controller = new HealthController(
      prisma as never,
      redis as never,
      signalingGateway as never,
      configService as never,
    );
  });

  it('reports status "ok" with 200 when every dependency is reachable', async () => {
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        dependencies: { database: 'up', redis: 'up', sfu: 'up', turn: 'up' },
      }),
    );
  });

  it('reports status "degraded" with 503 when the database is unreachable', async () => {
    prisma.ping.mockRejectedValue(new Error('connection refused'));
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'degraded' }));
  });

  it('reports sfu: down without affecting the database/redis checks', async () => {
    mockCheckLiveKitHttp.mockResolvedValue(false);
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencies: { database: 'up', redis: 'up', sfu: 'down', turn: 'up' },
      }),
    );
  });

  it('reports turn: down when the STUN binding check fails', async () => {
    mockCheckStunBinding.mockResolvedValue(false);
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencies: { database: 'up', redis: 'up', sfu: 'up', turn: 'down' },
      }),
    );
  });

  it('never includes hostnames, connection strings, or raw error messages in the response', async () => {
    prisma.ping.mockRejectedValue(new Error('postgresql://user:pass@internal-db-host:5432/raven unreachable'));
    const res = fakeResponse();

    await controller.check(res as never);

    const payload = JSON.stringify(res.json.mock.calls[0][0]);
    expect(payload).not.toContain('postgresql://');
    expect(payload).not.toContain('internal-db-host');
  });

  it('includes the signaling gateway metrics verbatim', async () => {
    signalingGateway.getMetrics.mockReturnValue({ activeConnections: 5, activeRooms: 2, activeParticipants: 7 });
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ signaling: { activeConnections: 5, activeRooms: 2, activeParticipants: 7 } }),
    );
  });
});
