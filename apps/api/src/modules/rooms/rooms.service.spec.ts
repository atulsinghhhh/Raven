import { RoomStatus } from '../../generated/prisma/client';
import { Environment } from '../../shared/environment/environment.constants';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { DashboardEventsService } from '../dashboard-ws/realtime/dashboard-events.service';
import { RoomEventsService } from '../signaling/rooms/room-events.service';
import { ActivityEventsService } from '../super-admin/activity-events.service';
import { SfuRoomStateService } from './sfu-room-state.service';
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
    project: {
      findUnique: jest.Mock;
    };
  };
  let roomState: {
    listLiveParticipantCounts: jest.Mock;
    listLiveParticipants: jest.Mock;
    closeLiveSession: jest.Mock;
  };
  let roomEvents: { publish: jest.Mock };
  let activityEvents: { record: jest.Mock };
  let dashboardEvents: { publish: jest.Mock };

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      project: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner1' }) },
    };
    roomState = {
      listLiveParticipantCounts: jest.fn(),
      listLiveParticipants: jest.fn(),
      closeLiveSession: jest.fn().mockResolvedValue(true),
    };
    roomEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    activityEvents = { record: jest.fn().mockResolvedValue(undefined) };
    dashboardEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new RoomsService(
      prisma as unknown as PrismaService,
      roomState as unknown as SfuRoomStateService,
      roomEvents as unknown as RoomEventsService,
      activityEvents as unknown as ActivityEventsService,
      dashboardEvents as unknown as DashboardEventsService,
    );
  });

  describe('create', () => {
    it('rejects a duplicate name within the same project', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1' });

      await expect(service.create(DEV, { name: 'lobby' })).rejects.toBeInstanceOf(ConflictError);
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it('allows the same name in a different project (only scoped per-project)', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({ id: 'r1', projectId: 'project2', name: 'lobby' });

      await expect(
        service.create({ projectId: 'project2', environment: Environment.DEVELOPMENT }, { name: 'lobby' }),
      ).resolves.toMatchObject({
        projectId: 'project2',
      });
    });

    it('getOrCreate returns the existing room instead of a 409 on a plain name collision', async () => {
      const existing = { id: 'r1', name: 'lobby' };
      prisma.room.findUnique.mockResolvedValue(existing);

      await expect(service.create(DEV, { name: 'lobby', getOrCreate: true })).resolves.toBe(existing);
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it("getOrCreate returns the winner's room instead of a 409 when two creates race", async () => {
      // The findUnique pre-check is a classic check-then-act race: two
      // participants both joining the same named room can both pass it,
      // then both reach prisma.room.create — the loser, having asked for
      // getOrCreate, fetches and returns the winner's row instead of
      // surfacing a 409 for what is not actually a conflict.
      const winner = { id: 'r1', name: 'lobby' };
      prisma.room.findUnique
        .mockResolvedValueOnce(null) // pre-check: name looked free
        .mockResolvedValueOnce(winner); // post-race refetch: the winner already landed
      prisma.room.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed on the fields: (`projectId`,`environment`,`name`)'), {
          code: 'P2002',
        }),
      );

      await expect(service.create(DEV, { name: 'lobby', getOrCreate: true })).resolves.toBe(winner);
    });

    it('turns a concurrent duplicate-name race into a clean ConflictError, not a raw Prisma error', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed on the fields: (`projectId`,`environment`,`name`)'), {
          code: 'P2002',
        }),
      );

      await expect(service.create(DEV, { name: 'lobby' })).rejects.toBeInstanceOf(ConflictError);
    });

    it('two genuinely concurrent getOrCreate calls for the same name both resolve to the one row that actually got created', async () => {
      // A stateful fake of the unique (projectId, environment, name) index,
      // not a canned sequence of mockResolvedValueOnce calls — this is what
      // actually distinguishes "two callers racing" from "one caller retried
      // twice": both Client A and Client B's create() calls are in flight
      // at once (Promise.all), and only whichever's prisma.room.create
      // settles first (Alice.tick()) is allowed to "win" the unique index.
      let stored: { id: string; name: string } | null = null;
      let nextId = 0;
      prisma.room.findUnique.mockImplementation(async () => stored);
      prisma.room.create.mockImplementation(async ({ data }: { data: { name: string } }) => {
        if (stored) {
          throw Object.assign(new Error('Unique constraint failed on the fields: (`projectId`,`environment`,`name`)'), {
            code: 'P2002',
          });
        }
        stored = { id: `r${++nextId}`, name: data.name };
        return stored;
      });

      const [a, b] = await Promise.all([
        service.create(DEV, { name: 'test-room', getOrCreate: true }),
        service.create(DEV, { name: 'test-room', getOrCreate: true }),
      ]);

      expect(a.id).toBe(b.id);
      expect(prisma.room.create).toHaveBeenCalledTimes(2); // one wins, one hits P2002 and refetches
    });
  });

  describe('dashboard realtime nudges (Phase 5C)', () => {
    it('publishes room.created, scoped to the project the room was created in', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
        name: 'lobby',
      });

      await service.create(DEV, { name: 'lobby' });

      expect(dashboardEvents.publish).toHaveBeenCalledWith('project1', {
        type: 'room.created',
        roomId: 'r1',
        name: 'lobby',
        environment: Environment.DEVELOPMENT,
      });
    });

    it('never sends the full room record — only roomId, name, and environment', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
        name: 'lobby',
        status: RoomStatus.ACTIVE,
        createdAt: new Date(),
      });

      await service.create(DEV, { name: 'lobby' });

      const [, payload] = dashboardEvents.publish.mock.calls[0];
      expect(Object.keys(payload).sort()).toEqual(['environment', 'name', 'roomId', 'type']);
    });

    it("scopes each project's room.created to its own channel — no cross-project delivery", async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({
        id: 'r2',
        projectId: 'project2',
        environment: Environment.DEVELOPMENT,
        name: 'lobby',
      });

      await service.create({ projectId: 'project2', environment: Environment.DEVELOPMENT }, { name: 'lobby' });

      expect(dashboardEvents.publish).toHaveBeenCalledWith('project2', expect.objectContaining({ roomId: 'r2' }));
      expect(dashboardEvents.publish).not.toHaveBeenCalledWith('project1', expect.anything());
    });

    it('does not publish room.created when creation fails on a duplicate name', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(DEV, { name: 'lobby' })).rejects.toBeInstanceOf(ConflictError);

      expect(dashboardEvents.publish).not.toHaveBeenCalled();
    });

    it('does not publish room.closed — this phase covers creation only', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
      });

      await service.close('r1', DEV);

      expect(dashboardEvents.publish).not.toHaveBeenCalled();
    });
  });

  describe('findOneForProject', () => {
    it('throws NotFoundError when the room belongs to a different project', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project-other',
        environment: Environment.DEVELOPMENT,
      });

      await expect(service.findOneForProject('r1', DEV)).rejects.toBeInstanceOf(NotFoundError);
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
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
      });

      await service.close('r1', DEV);

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: RoomStatus.CLOSED },
      });
    });

    /**
     * Closing used to stop at the row, which left the media session
     * running: the host still publishing, viewers still decoding, and
     * nobody told. These three cover the rest of the close.
     */
    it('evicts the live media session, not just the row', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
      });

      await service.close('r1', DEV);

      expect(roomState.closeLiveSession).toHaveBeenCalledWith('r1');
    });

    it('tells the participants the room closed, so a client can render an ending instead of a stall', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
      });

      await service.close('r1', DEV);

      expect(roomEvents.publish).toHaveBeenCalledWith('r1', { kind: 'closed' });
    });

    it('still closes when the node cannot be reached — a degraded close, not a failed one', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
      });
      roomState.closeLiveSession.mockResolvedValue(false);

      await expect(service.close('r1', DEV)).resolves.toBeUndefined();

      expect(prisma.room.update).toHaveBeenCalled();
      expect(roomEvents.publish).toHaveBeenCalled();
    });

    it('does not touch the media plane for a room in another project', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', projectId: 'other', environment: Environment.DEVELOPMENT });

      await expect(service.close('r1', DEV)).rejects.toBeInstanceOf(NotFoundError);

      expect(roomState.closeLiveSession).not.toHaveBeenCalled();
      expect(roomEvents.publish).not.toHaveBeenCalled();
    });
  });

  describe('findAllForProjectWithLiveState', () => {
    it('attaches a real live participant count per room when the SFU answers', async () => {
      prisma.room.findMany.mockResolvedValue([
        { id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'lobby' },
        { id: 'r2', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'support' },
      ]);
      roomState.listLiveParticipantCounts.mockResolvedValue(new Map([['r1', 3]]));

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
          // Absent from the map means that room's node did not answer.
          // Reported as unknown, not 0: the old service returned
          // 0 here, which conflated "nobody is in this room" with "we
          // could not find out".
          liveParticipantCount: null,
        },
      ]);
    });

    it('queries by room id, since the media plane is addressed by id', async () => {
      prisma.room.findMany.mockResolvedValue([
        { id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'lobby' },
      ]);
      roomState.listLiveParticipantCounts.mockResolvedValue(new Map());

      await service.findAllForProjectWithLiveState(DEV);

      expect(roomState.listLiveParticipantCounts).toHaveBeenCalledWith(['r1']);
    });

    it('reports null (not 0) for every room when no node answered — distinct from genuinely idle', async () => {
      prisma.room.findMany.mockResolvedValue([
        { id: 'r1', projectId: 'project1', environment: Environment.DEVELOPMENT, name: 'lobby' },
      ]);
      roomState.listLiveParticipantCounts.mockResolvedValue(undefined);

      const rooms = await service.findAllForProjectWithLiveState(DEV);

      expect(rooms[0].liveParticipantCount).toBeNull();
    });
  });

  describe('findOneForProjectWithLiveState', () => {
    it('attaches live participants and a matching count when the SFU answers', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
        name: 'lobby',
      });
      const participants = [{ identity: 'alice', joinedAt: new Date(), tracks: [] }];
      roomState.listLiveParticipants.mockResolvedValue(participants);

      const room = await service.findOneForProjectWithLiveState('r1', DEV);

      expect(room.liveParticipants).toBe(participants);
      expect(room.liveParticipantCount).toBe(1);
    });

    it('reports liveParticipants: null and liveParticipantCount: null when the node is unreachable', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project1',
        environment: Environment.DEVELOPMENT,
        name: 'lobby',
      });
      roomState.listLiveParticipants.mockResolvedValue(undefined);

      const room = await service.findOneForProjectWithLiveState('r1', DEV);

      expect(room.liveParticipants).toBeNull();
      expect(room.liveParticipantCount).toBeNull();
    });

    it('still throws NotFoundError for a room in a different project, without asking any node', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        projectId: 'project-other',
        environment: Environment.DEVELOPMENT,
      });

      await expect(service.findOneForProjectWithLiveState('r1', DEV)).rejects.toBeInstanceOf(NotFoundError);
      expect(roomState.listLiveParticipants).not.toHaveBeenCalled();
    });
  });
});
