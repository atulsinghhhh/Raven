import { HealthController } from './health.controller';
import { checkSfuHttp, checkStunBinding } from './dependency-checks.util';

jest.mock('./dependency-checks.util');

const mockCheckSfuHttp = checkSfuHttp as jest.Mock;
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
  let rtcServers: { listHealthyForProbe: jest.Mock };

  beforeEach(() => {
    prisma = { ping: jest.fn().mockResolvedValue(undefined) };
    redis = { ping: jest.fn().mockResolvedValue(undefined) };
    signalingGateway = {
      getMetrics: jest.fn().mockReturnValue({ activeConnections: 0, activeRooms: 0, activeParticipants: 0 }),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'turn.internalHost') return 'coturn';
        if (key === 'turn.port') return 3478;
        if (key === 'sfu.defaultRegion') return 'local';
        return undefined;
      }),
    };
    rtcServers = {
      listHealthyForProbe: jest
        .fn()
        .mockResolvedValue([{ name: 'sfu-local-01', internalUrl: 'http://sfu:7000' }]),
    };
    mockCheckSfuHttp.mockReset().mockResolvedValue(true);
    mockCheckStunBinding.mockReset().mockResolvedValue(true);

    controller = new HealthController(
      prisma as never,
      redis as never,
      signalingGateway as never,
      configService as never,
      rtcServers as never,
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
    mockCheckSfuHttp.mockResolvedValue(false);
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencies: { database: 'up', redis: 'up', sfu: 'down', turn: 'up' },
      }),
    );
  });

  it('probes only the region this instance allocates in', async () => {
    const res = fakeResponse();

    await controller.check(res as never);

    // A node in another region advertises an address private to that
    // network, so probing it would take this instance out of rotation over
    // capacity it would never allocate.
    expect(rtcServers.listHealthyForProbe).toHaveBeenCalledWith('local');
  });

  it('reports sfu: up when a later candidate answers after an unreachable one', async () => {
    rtcServers.listHealthyForProbe.mockResolvedValue([
      { name: 'sfu-local-01', internalUrl: 'http://10.10.1.4:7000' },
      { name: 'sfu-local-02', internalUrl: 'http://sfu:7000' },
    ]);
    mockCheckSfuHttp.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockCheckSfuHttp).toHaveBeenCalledTimes(2);
  });

  it('reports sfu: down when the region has no healthy node at all', async () => {
    rtcServers.listHealthyForProbe.mockResolvedValue([]);
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencies: { database: 'up', redis: 'up', sfu: 'down', turn: 'up' },
      }),
    );
    expect(mockCheckSfuHttp).not.toHaveBeenCalled();
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

  describe('liveness', () => {
    it('always reports ok without calling any dependency', () => {
      const res = fakeResponse();

      controller.liveness(res as never);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
      expect(prisma.ping).not.toHaveBeenCalled();
      expect(redis.ping).not.toHaveBeenCalled();
    });

    it('reports ok even while every dependency is down', () => {
      prisma.ping.mockRejectedValue(new Error('connection refused'));
      redis.ping.mockRejectedValue(new Error('connection refused'));
      const res = fakeResponse();

      controller.liveness(res as never);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('readiness', () => {
    it('behaves exactly like the /health alias for status and dependencies', async () => {
      const readyRes = fakeResponse();
      const aliasRes = fakeResponse();

      await controller.readiness(readyRes as never);
      await controller.check(aliasRes as never);

      expect(readyRes.status.mock.calls).toEqual(aliasRes.status.mock.calls);
      expect(readyRes.json.mock.calls).toEqual(aliasRes.json.mock.calls);
    });

    it('does not include a bare "status ok" shortcut — still runs every dependency check', async () => {
      prisma.ping.mockRejectedValue(new Error('connection refused'));
      const res = fakeResponse();

      await controller.readiness(res as never);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'degraded' }));
    });
  });
});
