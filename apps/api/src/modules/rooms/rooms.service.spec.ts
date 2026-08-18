import { RoomStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { LiveKitRoomService } from './livekit-room.service';
import { RoomsService } from './rooms.service';

describe('RoomsService', () => {
  let service: RoomsService;
  let prisma: {
    room: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let liveKitRoomService: {
    listLiveParticipantCounts: jest.Mock;
    listLiveParticipants: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    liveKitRoomService = {
      listLiveParticipantCounts: jest.fn(),
      listLiveParticipants: jest.fn(),
    };
    service = new RoomsService(
      prisma as unknown as PrismaService,
      liveKitRoomService as unknown as LiveKitRoomService,
    );
  });

  describe('create', () => {
    it('rejects a duplicate name within the same project', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1' });

      await expect(service.create('project1', { name: 'lobby' })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it('allows the same name in a different project (only scoped per-project)', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({ id: 'r1', projectId: 'project2', name: 'lobby' });

      await expect(service.create('project2', { name: 'lobby' })).resolves.toMatchObject({
        projectId: 'project2',
      });
    });
  });

  describe('findOneForProject', () => {
    it('throws NotFoundError when the room belongs to a different project', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project-other' });

      await expect(service.findOneForProject('r1', 'project1')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('returns the room when it belongs to the given project', async () => {
      const room = { id: 'r1', projectId: 'project1' };
      prisma.room.findUnique.mockResolvedValue(room);

      await expect(service.findOneForProject('r1', 'project1')).resolves.toEqual(room);
    });
  });

  describe('close', () => {
    it('soft-closes by setting status to CLOSED', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project1' });

      await service.close('r1', 'project1');

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: RoomStatus.CLOSED },
      });
    });
  });

  describe('findAllForProjectWithLiveState', () => {
    it('attaches a real live participant count per room when LiveKit is reachable', async () => {
      prisma.room.findMany.mockResolvedValue([
        { id: 'r1', projectId: 'project1', name: 'lobby' },
        { id: 'r2', projectId: 'project1', name: 'support' },
      ]);
      liveKitRoomService.listLiveParticipantCounts.mockResolvedValue(new Map([['lobby', 3]]));

      const rooms = await service.findAllForProjectWithLiveState('project1');

      expect(rooms).toEqual([
        { id: 'r1', projectId: 'project1', name: 'lobby', liveParticipantCount: 3 },
        { id: 'r2', projectId: 'project1', name: 'support', liveParticipantCount: 0 },
      ]);
    });

    it('reports null (not 0) for every room when LiveKit is unreachable — distinct from genuinely idle', async () => {
      prisma.room.findMany.mockResolvedValue([{ id: 'r1', projectId: 'project1', name: 'lobby' }]);
      liveKitRoomService.listLiveParticipantCounts.mockResolvedValue(undefined);

      const rooms = await service.findAllForProjectWithLiveState('project1');

      expect(rooms[0].liveParticipantCount).toBeNull();
    });
  });

  describe('findOneForProjectWithLiveState', () => {
    it('attaches live participants and a matching count when LiveKit is reachable', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project1', name: 'lobby' });
      const participants = [{ identity: 'alice', joinedAt: new Date(), tracks: [] }];
      liveKitRoomService.listLiveParticipants.mockResolvedValue(participants);

      const room = await service.findOneForProjectWithLiveState('r1', 'project1');

      expect(room.liveParticipants).toBe(participants);
      expect(room.liveParticipantCount).toBe(1);
    });

    it('reports liveParticipants: null and liveParticipantCount: null when LiveKit is unreachable', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project1', name: 'lobby' });
      liveKitRoomService.listLiveParticipants.mockResolvedValue(undefined);

      const room = await service.findOneForProjectWithLiveState('r1', 'project1');

      expect(room.liveParticipants).toBeNull();
      expect(room.liveParticipantCount).toBeNull();
    });

    it('still throws NotFoundError for a room in a different project, without calling LiveKit', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project-other' });

      await expect(service.findOneForProjectWithLiveState('r1', 'project1')).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(liveKitRoomService.listLiveParticipants).not.toHaveBeenCalled();
    });
  });
});
