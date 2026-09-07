import { ConfigService } from '@nestjs/config';
import { RtcServerStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { RtcServerRegistryService } from './rtc-server-registry.service';

const HEARTBEAT_TIMEOUT_SECONDS = 30;

function server(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    name: 'sfu-local-01',
    region: 'local',
    status: RtcServerStatus.HEALTHY,
    publicHost: 'localhost',
    internalUrl: 'http://sfu:7000',
    capacity: 100,
    activeRooms: 0,
    activeParticipants: 0,
    cpuPercent: null,
    memoryPercent: null,
    networkInBps: null,
    networkOutBps: null,
    version: '0.1.0',
    lastHeartbeatAt: new Date(),
    registeredAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RtcServerRegistryService', () => {
  let service: RtcServerRegistryService;
  let prisma: {
    rtcServer: {
      upsert: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      groupBy: jest.Mock;
      aggregate: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      rtcServer: {
        upsert: jest.fn().mockResolvedValue(server()),
        update: jest.fn().mockResolvedValue(server()),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(server()),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
      },
    };
    const config = {
      get: (key: string) =>
        key === 'sfu.heartbeatTimeoutSeconds' ? HEARTBEAT_TIMEOUT_SECONDS : undefined,
    } as unknown as ConfigService;
    service = new RtcServerRegistryService(prisma as unknown as PrismaService, config);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('register', () => {
    it('upserts by name so a restarting node reclaims its row', async () => {
      await service.register({
        name: 'sfu-local-01',
        region: 'local',
        publicHost: 'localhost',
        internalUrl: 'http://sfu:7000',
        capacity: 50,
        version: '0.1.0',
      });

      expect(prisma.rtcServer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'sfu-local-01' } }),
      );
    });

    it('resets load counters on re-registration rather than trusting the dead process', async () => {
      // A freshly booted SFU is serving nothing, whatever the old row said.
      await service.register({
        name: 'sfu-local-01',
        region: 'local',
        publicHost: 'localhost',
        internalUrl: 'http://sfu:7000',
        capacity: 50,
      });

      const { update } = prisma.rtcServer.upsert.mock.calls[0][0];
      expect(update).toMatchObject({
        activeRooms: 0,
        activeParticipants: 0,
        cpuPercent: null,
        memoryPercent: null,
      });
    });

    it('registers as HEALTHY so the node is immediately allocatable', async () => {
      await service.register({
        name: 'sfu-local-01',
        region: 'local',
        publicHost: 'localhost',
        internalUrl: 'http://sfu:7000',
        capacity: 50,
      });

      const call = prisma.rtcServer.upsert.mock.calls[0][0];
      expect(call.create.status).toBe(RtcServerStatus.HEALTHY);
      expect(call.update.status).toBe(RtcServerStatus.HEALTHY);
    });
  });

  describe('heartbeat', () => {
    it('records the reported load', async () => {
      await service.heartbeat('sfu-local-01', {
        activeRooms: 12,
        activeParticipants: 47,
        cpuPercent: 34.2,
        memoryPercent: 61.8,
        networkInBps: 12_400_000,
        networkOutBps: 48_900_000,
      });

      expect(prisma.rtcServer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'sfu-local-01' },
          data: expect.objectContaining({ activeRooms: 12, activeParticipants: 47, cpuPercent: 34.2 }),
        }),
      );
    });

    it('rejects a heartbeat from an unregistered node instead of inventing a row', async () => {
      // A heartbeat carries no region/host/capacity, so a row created from
      // one would be unusable for allocation.
      prisma.rtcServer.findUnique.mockResolvedValue(null);

      await expect(
        service.heartbeat('sfu-ghost', { activeRooms: 0, activeParticipants: 0 }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(prisma.rtcServer.update).not.toHaveBeenCalled();
    });

    it('promotes an unhealthy node back to healthy — the recovery path', async () => {
      prisma.rtcServer.findUnique.mockResolvedValue(
        server({ status: RtcServerStatus.UNHEALTHY }),
      );

      await service.heartbeat('sfu-local-01', { activeRooms: 0, activeParticipants: 0 });

      expect(prisma.rtcServer.update.mock.calls[0][0].data.status).toBe(RtcServerStatus.HEALTHY);
    });

    it('leaves a draining node draining, so a heartbeat cannot undo an operator decision', async () => {
      prisma.rtcServer.findUnique.mockResolvedValue(server({ status: RtcServerStatus.DRAINING }));

      await service.heartbeat('sfu-local-01', { activeRooms: 3, activeParticipants: 8 });

      expect(prisma.rtcServer.update.mock.calls[0][0].data).not.toHaveProperty('status');
    });
  });

  describe('markStaleServersUnhealthy', () => {
    it('marks nodes past the heartbeat deadline, and those that never heartbeated', async () => {
      prisma.rtcServer.updateMany.mockResolvedValue({ count: 2 });

      const count = await service.markStaleServersUnhealthy();

      expect(count).toBe(2);
      const where = prisma.rtcServer.updateMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ not: RtcServerStatus.UNHEALTHY });
      expect(where.OR).toEqual([
        { lastHeartbeatAt: { lt: expect.any(Date) } },
        { lastHeartbeatAt: null },
      ]);
      const deadline = where.OR[0].lastHeartbeatAt.lt as Date;
      expect(Date.now() - deadline.getTime()).toBeGreaterThanOrEqual(
        HEARTBEAT_TIMEOUT_SECONDS * 1000 - 50,
      );
    });

    it('never touches the rooms an unhealthy node is already serving', async () => {
      // Spec §26: do not kill active rooms without recovery logic. A missed
      // heartbeat is often a paused container, not a dead process.
      await service.markStaleServersUnhealthy();

      const data = prisma.rtcServer.updateMany.mock.calls[0][0].data;
      expect(data).toEqual({ status: RtcServerStatus.UNHEALTHY });
      expect(data).not.toHaveProperty('activeRooms');
    });

    it('survives a database outage rather than taking the API down with it', async () => {
      prisma.rtcServer.updateMany.mockRejectedValue(new Error('connection refused'));

      await expect(service.markStaleServersUnhealthy()).resolves.toBe(0);
    });
  });

  describe('setDraining', () => {
    it('drains a node without stopping it', async () => {
      await service.setDraining('sfu-local-01', true);

      expect(prisma.rtcServer.update).toHaveBeenCalledWith({
        where: { name: 'sfu-local-01' },
        data: { status: RtcServerStatus.DRAINING },
      });
    });

    it('rejects draining a node that is not registered', async () => {
      prisma.rtcServer.findUnique.mockResolvedValue(null);

      await expect(service.setDraining('sfu-ghost', true)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getFleetMetrics', () => {
    it('counts nodes by health and sums their reported load', async () => {
      prisma.rtcServer.groupBy.mockResolvedValue([
        { status: RtcServerStatus.HEALTHY, _count: { _all: 3 } },
        { status: RtcServerStatus.UNHEALTHY, _count: { _all: 1 } },
      ]);
      prisma.rtcServer.aggregate.mockResolvedValue({
        _sum: { activeRooms: 20, activeParticipants: 85, capacity: 400 },
        _count: { _all: 4 },
      });

      await expect(service.getFleetMetrics()).resolves.toEqual({
        servers: 4,
        healthyServers: 3,
        drainingServers: 0,
        unhealthyServers: 1,
        activeRooms: 20,
        activeParticipants: 85,
        capacity: 400,
      });
    });

    it('reports zeros for an empty fleet rather than nulls', async () => {
      await expect(service.getFleetMetrics()).resolves.toMatchObject({
        servers: 0,
        activeRooms: 0,
        activeParticipants: 0,
        capacity: 0,
      });
    });
  });
});
