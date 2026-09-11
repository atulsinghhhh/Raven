import { ConfigService } from '@nestjs/config';
import { RtcServerStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import {
  NoRtcCapacityError,
  RtcServerAllocatorService,
  RtcServerUnavailableError,
} from './rtc-server-allocator.service';

const DEFAULT_REGION = 'local';

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

describe('RtcServerAllocatorService', () => {
  let service: RtcServerAllocatorService;
  let prisma: {
    room: { findUnique: jest.Mock; updateMany: jest.Mock };
    rtcServer: { findMany: jest.Mock };
  };
  let redis: { client: { set: jest.Mock; del: jest.Mock } };

  beforeEach(() => {
    prisma = {
      room: {
        findUnique: jest.fn().mockResolvedValue({ rtcServer: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rtcServer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    redis = { client: { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) } };
    const config = {
      get: (key: string) => (key === 'sfu.defaultRegion' ? DEFAULT_REGION : undefined),
    } as unknown as ConfigService;

    service = new RtcServerAllocatorService(
      prisma as unknown as PrismaService,
      config,
      redis as unknown as RedisService,
    );
  });

  it("reuses the room's existing assignment without consulting the fleet", async () => {
    // Every participant in a room must land on the same SFU: that is what
    // makes it an SFU, not a mesh.
    const assigned = server({ name: 'sfu-already' });
    prisma.room.findUnique.mockResolvedValue({ rtcServer: assigned });

    await expect(service.allocate('room-1')).resolves.toBe(assigned);
    expect(prisma.rtcServer.findMany).not.toHaveBeenCalled();
    expect(prisma.room.updateMany).not.toHaveBeenCalled();
  });

  it('allocates the least-loaded healthy server in the requested region', async () => {
    const chosen = server({ id: 'srv-quiet', name: 'sfu-asia-02', region: 'asia-south', activeRooms: 1 });
    prisma.rtcServer.findMany.mockResolvedValue([chosen, server({ id: 'srv-busy', activeRooms: 9 })]);

    await expect(service.allocate('room-1', 'asia-south')).resolves.toBe(chosen);
    expect(prisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: 'room-1', rtcServerId: null },
      data: { rtcServerId: 'srv-quiet' },
    });
  });

  it('orders candidates by active rooms, then participants', async () => {
    prisma.rtcServer.findMany.mockResolvedValue([server()]);

    await service.allocate('room-1');

    expect(prisma.rtcServer.findMany.mock.calls[0][0].orderBy).toEqual([
      { activeRooms: 'asc' },
      { activeParticipants: 'asc' },
    ]);
  });

  it('only considers HEALTHY servers — never draining or unhealthy ones', async () => {
    prisma.rtcServer.findMany.mockResolvedValue([server()]);

    await service.allocate('room-1');

    expect(prisma.rtcServer.findMany.mock.calls[0][0].where.status).toBe(RtcServerStatus.HEALTHY);
  });

  it('skips a server that is already at capacity', async () => {
    const full = server({ id: 'srv-full', activeRooms: 100, capacity: 100 });
    const spare = server({ id: 'srv-spare', activeRooms: 99, capacity: 100 });
    prisma.rtcServer.findMany.mockResolvedValue([full, spare]);

    const chosen = await service.allocate('room-1');
    expect(chosen.id).toBe('srv-spare');
  });

  it('falls back to another region rather than failing the call', async () => {
    // A participant on a distant SFU has worse latency; a participant who
    // cannot connect has no call at all.
    const elsewhere = server({ id: 'srv-eu', name: 'sfu-eu-01', region: 'eu-west' });
    prisma.rtcServer.findMany
      .mockResolvedValueOnce([]) // nothing in asia-south
      .mockResolvedValueOnce([elsewhere]); // something somewhere

    await expect(service.allocate('room-1', 'asia-south')).resolves.toBe(elsewhere);
  });

  it('throws NoRtcCapacityError when the whole fleet is full or down', async () => {
    prisma.rtcServer.findMany.mockResolvedValue([]);

    await expect(service.allocate('room-1', 'asia-south')).rejects.toBeInstanceOf(NoRtcCapacityError);
    expect(prisma.room.updateMany).not.toHaveBeenCalled();
  });

  it('uses the configured default region when none is requested', async () => {
    prisma.rtcServer.findMany.mockResolvedValue([server()]);

    await service.allocate('room-1');

    expect(prisma.rtcServer.findMany.mock.calls[0][0].where.region).toBe(DEFAULT_REGION);
  });

  describe('concurrent allocation', () => {
    it('yields to the winner when the conditional write matches nothing', async () => {
      // Two participants joining an empty room at once must not end up on
      // two different SFUs.
      const winner = server({ id: 'srv-winner', name: 'sfu-winner' });
      prisma.rtcServer.findMany.mockResolvedValue([server({ id: 'srv-loser' })]);
      prisma.room.updateMany.mockResolvedValue({ count: 0 });
      prisma.room.findUnique
        .mockResolvedValueOnce({ rtcServer: null }) // initial check
        .mockResolvedValueOnce({ rtcServer: null }) // after lock
        .mockResolvedValueOnce({ rtcServer: winner }); // re-read after losing

      await expect(service.allocate('room-1')).resolves.toBe(winner);
    });

    it('re-checks after acquiring the lock, so the loser does no work', async () => {
      const winner = server({ id: 'srv-winner' });
      prisma.room.findUnique.mockResolvedValueOnce({ rtcServer: null }).mockResolvedValueOnce({ rtcServer: winner });

      await expect(service.allocate('room-1')).resolves.toBe(winner);
      expect(prisma.rtcServer.findMany).not.toHaveBeenCalled();
    });

    it('allocates anyway when Redis is unavailable', async () => {
      // Correctness rests on the conditional write, not the lock: a room
      // join must not fail because Redis hiccuped.
      redis.client.set.mockRejectedValue(new Error('connection refused'));
      const chosen = server();
      prisma.rtcServer.findMany.mockResolvedValue([chosen]);

      await expect(service.allocate('room-1')).resolves.toBe(chosen);
    });

    it('releases the lock even when allocation fails', async () => {
      prisma.rtcServer.findMany.mockResolvedValue([]);

      await expect(service.allocate('room-1')).rejects.toBeInstanceOf(NoRtcCapacityError);
      expect(redis.client.del).toHaveBeenCalled();
    });
  });

  /**
   * A room is pinned to one SFU for its whole life, and that pin used to be
   * trusted unconditionally. These cover what happens once the node behind
   * it stops answering — the case where returning the pin is the worst
   * available answer rather than the cheapest.
   */
  describe('an unhealthy pinned server', () => {
    const dead = server({ status: RtcServerStatus.UNHEALTHY, name: 'sfu-dead-01' });

    it('refuses the join rather than migrating a room that still has participants', async () => {
      prisma.room.findUnique.mockResolvedValue({ rtcServer: dead });

      // The room is live. Moving it would mean renegotiating every
      // PeerConnection against a node holding none of their media state,
      // so the joiner is failed and the call is preserved.
      await expect(service.allocate('room-1', { isRoomOccupied: async () => true })).rejects.toBeInstanceOf(
        RtcServerUnavailableError,
      );

      expect(prisma.room.updateMany).not.toHaveBeenCalled();
    });

    it('names the node but never its address', async () => {
      prisma.room.findUnique.mockResolvedValue({ rtcServer: dead });

      let err!: RtcServerUnavailableError;
      try {
        await service.allocate('room-1', { isRoomOccupied: async () => true });
      } catch (caught) {
        err = caught as RtcServerUnavailableError;
      }

      // Same rule as `room.joined`: a caller that learned an SFU's address
      // could route around the control plane for good.
      // getResponse() is exactly what the filter forwards to the client, so
      // this asserts on the wire body rather than on an internal field.
      const body = JSON.stringify(err.getResponse());
      expect(err.getResponse()).toMatchObject({
        code: 'RAVEN_RTC_SERVER_UNAVAILABLE',
        roomId: 'room-1',
        rtcServer: 'sfu-dead-01',
      });
      expect(body).not.toContain(dead.internalUrl);
      expect(body).not.toContain(dead.publicHost);
    });

    it('releases the pin and reallocates when the room is empty', async () => {
      // This is the path that used to strand a room forever: the node was
      // excluded from new allocations, so it could never be chosen again,
      // and the pin was never cleared, so nothing else could be either.
      const healthy = server({ id: 'srv-2', name: 'sfu-live-02' });
      prisma.room.findUnique.mockResolvedValueOnce({ rtcServer: dead }).mockResolvedValue({ rtcServer: null });
      prisma.rtcServer.findMany.mockResolvedValue([healthy]);

      await expect(service.allocate('room-1', { isRoomOccupied: async () => false })).resolves.toEqual(healthy);

      // Cleared conditionally on the id it still held, so a concurrent
      // allocation that already re-pinned the room is not undone.
      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', rtcServerId: dead.id },
        data: { rtcServerId: null },
      });
    });

    it('yields to a concurrent allocation that cleared the pin first', async () => {
      const winner = server({ id: 'srv-3', name: 'sfu-winner-03' });
      prisma.room.findUnique.mockResolvedValueOnce({ rtcServer: dead }).mockResolvedValue({ rtcServer: winner });
      prisma.room.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.allocate('room-1', { isRoomOccupied: async () => false })).resolves.toEqual(winner);
      // It took the winner's choice instead of allocating a second server.
      expect(prisma.rtcServer.findMany).not.toHaveBeenCalled();
    });

    it('assumes the room is occupied when no probe is given', async () => {
      prisma.room.findUnique.mockResolvedValue({ rtcServer: dead });

      // The safe direction. A wrong "unavailable" costs a retry; a wrong
      // release splits a live room across two SFUs.
      await expect(service.allocate('room-1')).rejects.toBeInstanceOf(RtcServerUnavailableError);
    });

    it('still serves a room pinned to a DRAINING node', async () => {
      // Draining means "take no new rooms", not "drop the ones you have".
      // Refusing joiners here would turn a graceful upgrade into an outage.
      const draining = server({ status: RtcServerStatus.DRAINING });
      prisma.room.findUnique.mockResolvedValue({ rtcServer: draining });

      await expect(service.allocate('room-1', { isRoomOccupied: async () => true })).resolves.toEqual(draining);
    });

    it('accepts a bare region string as the second argument, as it always did', async () => {
      // A published module boundary; the two shapes are unambiguous.
      const healthy = server();
      prisma.rtcServer.findMany.mockResolvedValue([healthy]);

      await expect(service.allocate('room-1', 'local')).resolves.toEqual(healthy);
      expect(prisma.rtcServer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: RtcServerStatus.HEALTHY, region: 'local' } }),
      );
    });
  });

  describe('releaseRoom', () => {
    it('clears the assignment so the next join allocates fresh', async () => {
      // Keeping a stale assignment would pin an empty room to a node that
      // may since have been drained or replaced.
      await service.releaseRoom('room-1');

      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', rtcServerId: { not: null } },
        data: { rtcServerId: null },
      });
    });
  });

  describe('assignedServerFor', () => {
    it('returns null for a room with no live media session', async () => {
      await expect(service.assignedServerFor('room-1')).resolves.toBeNull();
    });

    it('returns null for a room that does not exist', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.assignedServerFor('nope')).resolves.toBeNull();
    });
  });
});
