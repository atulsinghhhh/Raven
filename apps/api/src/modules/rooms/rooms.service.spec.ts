import { RoomStatus } from '../../generated/prisma/client';
import { Environment } from '../../shared/environment/environment.constants';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { LiveKitRoomService } from './livekit-room.service';
import { RoomsService } from './rooms.service';

const DEV = { projectId: 'project1', environment: Environment.DEVELOPMENT };
const PROD = { projectId: 'project1', environment: Environment.PRODUCTION };

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

      await expect(service.create(DEV, { name: 'lobby' })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it('allows the same name in a different project (only scoped per-project)', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({ id: 'r1', projectId: 'project2', name: 'lobby' });

      await expect(service.create({ projectId: 'project2', environment: Environment.DEVELOPMENT }, { name: 'lobby' })).resolves.toMatchObject({
        projectId: 'project2',
      });
    });
  });

  describe('findOneForProject', () => {
    it('throws NotFoundError when the room belongs to a different project', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project-other', environment: Environment.DEVELOPMENT });

      await expect(service.findOneForProject('r1', DEV)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('returns the room when it belongs to the given project', async () => {
      const room = { id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT };
      prisma.room.findUnique.mockResolvedValue(room);

      await expect(service.findOneForProject('r1', DEV)).resolves.toEqual(room);
    });
  });

  describe('environment isolation', () => {
    it('scopes the duplicate-name lookup to one environment', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({ id: 'r1' });

      await service.create(PROD, { name: 'lobby' });

      // Without environment in the composite key, creating a production
      // "lobby" would collide with the development one.
      expect(prisma.room.findUnique).toHaveBeenCalledWith({
        where: {
          projectId_environment_name: {
            projectId: 'project1',
            environment: Environment.PRODUCTION,
            name: 'lobby',
          },
        },
      });
    });

    it('lets the same room name exist in two environments of one project', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({ id: 'r2', environment: Environment.PRODUCTION });

      await expect(service.create(PROD, { name: 'lobby' })).resolves.toBeDefined();
      expect(prisma.room.create).toHaveBeenCalledWith({
        data: { projectId: 'project1', environment: Environment.PRODUCTION, name: 'lobby' },
      });
    });

    it('hides a production room from a development-scoped read', async () => {
      // The whole point of environments: a development API key holding a
      // production room id learns nothing from it.
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.PRODUCTION,
      });

      await expect(service.findOneForProject('r1', DEV)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('reports a cross-environment miss as not-found, never as forbidden', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.PRODUCTION,
      });

      // A 403 would confirm the id is real somewhere, which is exactly what
      // an attacker probing ids wants to learn.
      await expect(service.findOneForProject('r1', DEV)).rejects.toMatchObject({
        code: 'RAVEN_ROOM_NOT_FOUND',
      });
    });

    it('refuses to close a room in another environment', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.PRODUCTION,
      });

      await expect(service.close('r1', DEV)).rejects.toBeInstanceOf(NotFoundError);
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it('filters listings by environment', async () => {
      prisma.room.findMany.mockResolvedValue([]);

      await service.findAllForProject(PROD);

      expect(prisma.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ environment: Environment.PRODUCTION }),
        }),
      );
    });
  });

  describe('close', () => {
    it('soft-closes by setting status to CLOSED', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT });

      await service.close('r1', DEV);

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: RoomStatus.CLOSED },
      });
    });
  });

  describe('findAllForProjectWithLiveState', () => {
    it('attaches a real live participant count per room when LiveKit is reachable', async () => {
      prisma.room.findMany.mockResolvedValue([
        { id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'lobby' },
        { id: 'r2', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'support' },
      ]);
      liveKitRoomService.listLiveParticipantCounts.mockResolvedValue(new Map([['lobby', 3]]));

      const rooms = await service.findAllForProjectWithLiveState(DEV);

      expect(rooms).toEqual([
        {
          id: 'r1',
          projectId: 'project1',
          environment: Environment.DEVELOPMENT,
          name: 'lobby',
          liveParticipantCount: 3,
        },
        {
          id: 'r2',
          projectId: 'project1',
          environment: Environment.DEVELOPMENT,
          name: 'support',
          liveParticipantCount: 0,
        },
      ]);
    });

    it('reports null (not 0) for every room when LiveKit is unreachable — distinct from genuinely idle', async () => {
      prisma.room.findMany.mockResolvedValue([{ id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'lobby' }]);
      liveKitRoomService.listLiveParticipantCounts.mockResolvedValue(undefined);

      const rooms = await service.findAllForProjectWithLiveState(DEV);

      expect(rooms[0].liveParticipantCount).toBeNull();
    });
  });

  describe('findOneForProjectWithLiveState', () => {
    it('attaches live participants and a matching count when LiveKit is reachable', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'lobby' });
      const participants = [{ identity: 'alice', joinedAt: new Date(), tracks: [] }];
      liveKitRoomService.listLiveParticipants.mockResolvedValue(participants);

      const room = await service.findOneForProjectWithLiveState('r1', DEV);

      expect(room.liveParticipants).toBe(participants);
      expect(room.liveParticipantCount).toBe(1);
    });

    it('reports liveParticipants: null and liveParticipantCount: null when LiveKit is unreachable', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'lobby' });
      liveKitRoomService.listLiveParticipants.mockResolvedValue(undefined);

      const room = await service.findOneForProjectWithLiveState('r1', DEV);

      expect(room.liveParticipants).toBeNull();
      expect(room.liveParticipantCount).toBeNull();
    });

    it('still throws NotFoundError for a room in a different project, without calling LiveKit', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'project-other', environment: Environment.DEVELOPMENT });

      await expect(service.findOneForProjectWithLiveState('r1', DEV)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(liveKitRoomService.listLiveParticipants).not.toHaveBeenCalled();
    });
  });
});
