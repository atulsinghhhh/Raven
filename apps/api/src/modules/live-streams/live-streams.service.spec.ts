import { ChatMemberRole, LiveStreamHostRole, LiveStreamStatus, LiveStreamVisibility } from '../../generated/prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { Environment } from '../../shared/environment/environment.constants';
import { LiveStreamsService } from './live-streams.service';

/**
 * Hand-rolled Prisma/service stubs, same style as
 * conversations.service.spec.ts: what's under test is LiveStreamsService's
 * own lifecycle/role logic, not Prisma or the services it reuses (those
 * have their own specs).
 */
describe('LiveStreamsService', () => {
  let service: LiveStreamsService;
  let prisma: {
    liveStream: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
    liveStreamHost: { upsert: jest.Mock; update: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
    room: { findUnique: jest.Mock };
    conversation: { findUnique: jest.Mock };
  };
  let roomsService: { create: jest.Mock; close: jest.Mock };
  let sfuRoomState: { listLiveParticipants: jest.Mock };
  let rtcTokensService: { create: jest.Mock };
  let conversationsService: { create: jest.Mock; addMember: jest.Mock; removeMember: jest.Mock };
  let messagesService: { send: jest.Mock };
  let chatTokenService: { issue: jest.Mock };
  let webhooks: { emit: jest.Mock };

  const SCOPE = { projectId: 'p1', environment: Environment.DEVELOPMENT };
  const OTHER_PROJECT_SCOPE = { projectId: 'p2', environment: Environment.DEVELOPMENT };

  const baseStream = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'stream-internal-uuid',
    publicId: 'stream_abc123',
    projectId: 'p1',
    environment: Environment.DEVELOPMENT,
    roomId: 'room-uuid',
    conversationId: 'conv-uuid',
    chatRootMessageId: 'msg-uuid',
    title: 'My Stream',
    description: null,
    thumbnailUrl: null,
    category: null,
    tags: [],
    language: null,
    visibility: LiveStreamVisibility.PUBLIC,
    metadata: null,
    status: LiveStreamStatus.CREATED,
    peakViewerCount: 0,
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      // update() defaults to resolving with {}: the peak-viewer-count
      // write in toView() is a fire-and-forget background update that
      // most tests below never intend to exercise; only tests that
      // actually assert on update()'s behavior override this.
      liveStream: { create: jest.fn(), update: jest.fn().mockResolvedValue({}), findUnique: jest.fn(), findMany: jest.fn() },
      liveStreamHost: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      room: { findUnique: jest.fn() },
      conversation: { findUnique: jest.fn() },
    };
    roomsService = {
      create: jest.fn().mockResolvedValue({ id: 'room-uuid', name: 'stream_abc123' }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    sfuRoomState = { listLiveParticipants: jest.fn() };
    rtcTokensService = { create: jest.fn().mockResolvedValue({ token: 'rtc-jwt', endpoint: 'ws://x' }) };
    conversationsService = {
      create: jest.fn().mockResolvedValue({ id: 'conv-uuid', publicId: 'conv_xyz789' }),
      addMember: jest.fn().mockResolvedValue({ userId: 'u1', role: ChatMemberRole.MEMBER }),
      removeMember: jest.fn().mockResolvedValue(undefined),
    };
    messagesService = {
      send: jest.fn().mockResolvedValue({ message: { id: 'msg-uuid', publicId: 'msg_root' } }),
    };
    chatTokenService = { issue: jest.fn().mockReturnValue({ token: 'chat-jwt' }) };
    webhooks = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new LiveStreamsService(
      prisma as never,
      roomsService as never,
      sfuRoomState as never,
      rtcTokensService as never,
      conversationsService as never,
      messagesService as never,
      chatTokenService as never,
      webhooks as never,
    );
  });

  describe('create()', () => {
    it('creates a dedicated room and an attached conversation, not a developer-supplied one', async () => {
      prisma.liveStream.create.mockResolvedValue(baseStream({ hosts: [] }));
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' });

      expect(roomsService.create).toHaveBeenCalledWith(SCOPE, { name: expect.stringMatching(/^stream_/) });
      expect(conversationsService.create).toHaveBeenCalledWith(
        SCOPE,
        expect.objectContaining({ roomId: 'room-uuid' }),
      );
    });

    it('registers the creator as HOST, not CO_HOST', async () => {
      prisma.liveStream.create.mockResolvedValue(baseStream({ hosts: [] }));
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' });

      expect(prisma.liveStream.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hosts: { create: { identity: 'alice', role: LiveStreamHostRole.HOST } },
          }),
        }),
      );
    });

    it('creates a system root message for reactions to attach to, before the stream row itself exists', async () => {
      const order: string[] = [];
      messagesService.send.mockImplementation(async () => {
        order.push('root message');
        return { message: { id: 'msg-uuid', publicId: 'msg_root' } };
      });
      prisma.liveStream.create.mockImplementation(async () => {
        order.push('stream row');
        return baseStream({ hosts: [] });
      });
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' });

      expect(order).toEqual(['root message', 'stream row']);
      expect(prisma.liveStream.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ chatRootMessageId: 'msg-uuid' }) }),
      );
    });

    it('never emits live_stream.created before the stream is durably stored', async () => {
      const order: string[] = [];
      prisma.liveStream.create.mockImplementation(async () => {
        order.push('create');
        return baseStream({ hosts: [] });
      });
      webhooks.emit.mockImplementation(async () => {
        order.push('emit');
      });
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' });

      expect(order).toEqual(['create', 'emit']);
      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.created',
        expect.objectContaining({ hostIdentity: 'alice', title: 'My Stream' }),
      );
    });
  });

  describe('resolveRaw() — stream isolation, exercised through get()', () => {
    it('404s for a stream belonging to a different project, not 403', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ projectId: 'p1' }));

      await expect(service.get(OTHER_PROJECT_SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_NOT_FOUND,
      });
    });

    it('404s for a stream in a different environment of the same project', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ environment: Environment.PRODUCTION }));

      await expect(service.get(SCOPE, 'stream_abc123')).rejects.toBeInstanceOf(AppError);
    });

    it('resolves by public id or internal id depending on the prefix', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.get(SCOPE, 'stream_abc123');
      expect(prisma.liveStream.findUnique).toHaveBeenCalledWith({ where: { publicId: 'stream_abc123' } });

      await service.get(SCOPE, 'stream-internal-uuid');
      expect(prisma.liveStream.findUnique).toHaveBeenCalledWith({ where: { id: 'stream-internal-uuid' } });
    });
  });

  describe('lifecycle', () => {
    it('start() transitions CREATED to LIVE and stamps startedAt', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.CREATED }));
      prisma.liveStream.update.mockResolvedValue(
        baseStream({ status: LiveStreamStatus.LIVE, startedAt: new Date('2026-01-01T00:05:00.000Z') }),
      );
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.start(SCOPE, 'stream_abc123');

      expect(prisma.liveStream.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: LiveStreamStatus.LIVE }) }),
      );
      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.started',
        expect.objectContaining({ streamId: 'stream_abc123' }),
      );
    });

    it('rejects starting a stream that is already LIVE', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE }));

      await expect(service.start(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
      expect(prisma.liveStream.update).not.toHaveBeenCalled();
      expect(webhooks.emit).not.toHaveBeenCalled();
    });

    it('rejects starting a stream that has already ENDED', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));

      await expect(service.start(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
    });

    it('end() transitions LIVE to ENDED, stamps endedAt, and closes the underlying room', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(
        baseStream({ status: LiveStreamStatus.LIVE, startedAt: new Date('2026-01-01T00:00:00.000Z') }),
      );
      prisma.liveStream.update.mockResolvedValue(
        baseStream({
          status: LiveStreamStatus.ENDED,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          endedAt: new Date('2026-01-01T00:10:00.000Z'),
        }),
      );
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.end(SCOPE, 'stream_abc123');

      expect(roomsService.close).toHaveBeenCalledWith('room-uuid', SCOPE);
      // durationMs is computed from the service's own freshly-taken
      // `endedAt` (real wall-clock time at the moment end() runs), not
      // from the mocked update() return value, so this asserts it's a
      // real, positive duration against the fixed startedAt above,
      // rather than an exact number this test has no way to control.
      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.ended',
        expect.objectContaining({ streamId: 'stream_abc123', durationMs: expect.any(Number) }),
      );
      const [, , payload] = webhooks.emit.mock.calls[0];
      expect(payload.durationMs).toBeGreaterThan(0);
    });

    it('rejects ending a stream that was never started (still CREATED)', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.CREATED }));

      await expect(service.end(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
      expect(roomsService.close).not.toHaveBeenCalled();
    });

    it('rejects ending a stream that has already ENDED — no ENDED to LIVE resurrection path exists', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));

      await expect(service.end(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
    });

    it('rejects update() on an ENDED stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));

      await expect(service.update(SCOPE, 'stream_abc123', { title: 'New title' })).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
    });
  });

  describe('addHost() — host/co-host credentials', () => {
    beforeEach(() => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-uuid', publicId: 'conv_xyz789' });
    });

    it('mints an RTC token with full publish permissions', async () => {
      prisma.liveStreamHost.upsert.mockResolvedValue({
        identity: 'bob',
        role: LiveStreamHostRole.CO_HOST,
        invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' });

      expect(rtcTokensService.create).toHaveBeenCalledWith(
        SCOPE,
        'room-uuid',
        expect.objectContaining({
          participantIdentity: 'bob',
          permissions: expect.objectContaining({ publish: true, publishAudio: true, publishVideo: true }),
        }),
      );
    });

    it('grants MODERATOR chat role for a CO_HOST, ADMIN for a HOST', async () => {
      prisma.liveStreamHost.upsert.mockResolvedValueOnce({
        identity: 'bob',
        role: LiveStreamHostRole.CO_HOST,
        invitedAt: new Date(),
      });
      await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob', role: LiveStreamHostRole.CO_HOST });
      expect(conversationsService.addMember).toHaveBeenCalledWith(
        SCOPE,
        'conv_xyz789',
        expect.objectContaining({ role: ChatMemberRole.MODERATOR }),
      );

      prisma.liveStreamHost.upsert.mockResolvedValueOnce({
        identity: 'carol',
        role: LiveStreamHostRole.HOST,
        invitedAt: new Date(),
      });
      await service.addHost(SCOPE, 'stream_abc123', { identity: 'carol', role: LiveStreamHostRole.HOST });
      expect(conversationsService.addMember).toHaveBeenCalledWith(
        SCOPE,
        'conv_xyz789',
        expect.objectContaining({ role: ChatMemberRole.ADMIN }),
      );
    });

    it('defaults to CO_HOST when no role is given', async () => {
      prisma.liveStreamHost.upsert.mockResolvedValue({
        identity: 'bob',
        role: LiveStreamHostRole.CO_HOST,
        invitedAt: new Date(),
      });

      await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' });

      expect(prisma.liveStreamHost.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ role: LiveStreamHostRole.CO_HOST }),
        }),
      );
    });

    it('emits live_stream.host_joined with the role actually assigned', async () => {
      prisma.liveStreamHost.upsert.mockResolvedValue({
        identity: 'bob',
        role: LiveStreamHostRole.CO_HOST,
        invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' });

      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.host_joined',
        expect.objectContaining({ identity: 'bob', role: LiveStreamHostRole.CO_HOST }),
      );
    });

    it('rejects adding a host to an ENDED stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));

      await expect(service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' })).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
      expect(rtcTokensService.create).not.toHaveBeenCalled();
    });
  });

  describe('createViewerToken() — never trusts a client into becoming a host', () => {
    beforeEach(() => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-uuid', publicId: 'conv_xyz789' });
    });

    it('always mints subscribe-only RTC permissions', async () => {
      await service.createViewerToken(SCOPE, 'stream_abc123', 'dave');

      expect(rtcTokensService.create).toHaveBeenCalledWith(
        SCOPE,
        'room-uuid',
        expect.objectContaining({
          participantIdentity: 'dave',
          permissions: expect.objectContaining({
            subscribe: true,
            publish: false,
            publishAudio: false,
            publishVideo: false,
            publishData: false,
          }),
        }),
      );
    });

    it('always grants MEMBER chat role, never MODERATOR/ADMIN', async () => {
      await service.createViewerToken(SCOPE, 'stream_abc123', 'dave');

      expect(conversationsService.addMember).toHaveBeenCalledWith(
        SCOPE,
        'conv_xyz789',
        expect.objectContaining({ role: ChatMemberRole.MEMBER }),
      );
    });

    it('the DTO this endpoint accepts has no field that could request publish access', async () => {
      // Structural guarantee, not just a runtime one: createViewerToken's
      // own signature takes a bare identity string: there is no
      // "role"/"permissions" parameter anywhere in the call for an
      // untrusted client to influence, unlike addHost's dedicated DTO.
      await service.createViewerToken(SCOPE, 'stream_abc123', 'dave');
      const [, , tokenDto] = rtcTokensService.create.mock.calls[0];
      expect(tokenDto.permissions.publish).toBe(false);
    });

    it('emits live_stream.viewer_joined', async () => {
      await service.createViewerToken(SCOPE, 'stream_abc123', 'dave');

      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.viewer_joined',
        expect.objectContaining({ streamId: 'stream_abc123', identity: 'dave' }),
      );
    });

    it('rejects minting a viewer token for an ENDED stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));

      await expect(service.createViewerToken(SCOPE, 'stream_abc123', 'dave')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
    });
  });

  describe('removeHost()', () => {
    it('soft-removes the host and removes their chat membership', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.liveStreamHost.findUnique.mockResolvedValue({
        id: 'host-row-uuid',
        identity: 'bob',
        removedAt: null,
      });
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.removeHost(SCOPE, 'stream_abc123', 'bob');

      expect(prisma.liveStreamHost.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ removedAt: expect.any(Date) }) }),
      );
      expect(conversationsService.removeMember).toHaveBeenCalledWith(SCOPE, 'conv_xyz789', 'bob');
      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.host_left',
        expect.objectContaining({ identity: 'bob' }),
      );
    });

    it('404s removing a host who was never added', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.liveStreamHost.findUnique.mockResolvedValue(null);

      await expect(service.removeHost(SCOPE, 'stream_abc123', 'ghost')).rejects.toBeInstanceOf(AppError);
      expect(webhooks.emit).not.toHaveBeenCalled();
    });

    it('404s removing a host who was already removed', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.liveStreamHost.findUnique.mockResolvedValue({
        id: 'host-row-uuid',
        identity: 'bob',
        removedAt: new Date(),
      });

      await expect(service.removeHost(SCOPE, 'stream_abc123', 'bob')).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('leave()', () => {
    it('emits live_stream.viewer_left for a real stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());

      await service.leave(SCOPE, 'stream_abc123', 'dave');

      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.viewer_left',
        expect.objectContaining({ streamId: 'stream_abc123', identity: 'dave' }),
      );
    });

    it('404s for a stream in another project rather than silently accepting the leave signal', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ projectId: 'someone-elses-project' }));

      await expect(service.leave(SCOPE, 'stream_abc123', 'dave')).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('viewer count — derived live from the SFU, never stored per-viewer', () => {
    it('excludes registered hosts from the viewer count', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.liveStreamHost.findMany.mockResolvedValue([
        { identity: 'alice', role: LiveStreamHostRole.HOST, invitedAt: new Date() },
      ]);
      prisma.room.findUnique.mockResolvedValue({ name: 'stream_abc123' });
      sfuRoomState.listLiveParticipants.mockResolvedValue([
        { identity: 'alice', joinedAt: new Date(), tracks: [] },
        { identity: 'dave', joinedAt: new Date(), tracks: [] },
        { identity: 'erin', joinedAt: new Date(), tracks: [] },
      ]);

      const view = await service.get(SCOPE, 'stream_abc123');

      expect(view.viewerCount).toBe(2);
    });

    it('reports null, not zero, when the SFU cannot be reached', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      prisma.room.findUnique.mockResolvedValue({ name: 'stream_abc123' });
      sfuRoomState.listLiveParticipants.mockResolvedValue(undefined);

      const view = await service.get(SCOPE, 'stream_abc123');

      expect(view.viewerCount).toBeNull();
    });

    it('list() never calls the SFU — one round trip per row would make listing as slow as the slowest stream', async () => {
      prisma.liveStream.findMany.mockResolvedValue([baseStream()]);
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.list(SCOPE);

      expect(sfuRoomState.listLiveParticipants).not.toHaveBeenCalled();
    });

    it('raises peakViewerCount when live viewers exceed the stored peak', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ peakViewerCount: 1 }));
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      prisma.room.findUnique.mockResolvedValue({ name: 'stream_abc123' });
      sfuRoomState.listLiveParticipants.mockResolvedValue([
        { identity: 'a', joinedAt: new Date(), tracks: [] },
        { identity: 'b', joinedAt: new Date(), tracks: [] },
        { identity: 'c', joinedAt: new Date(), tracks: [] },
      ]);

      const view = await service.get(SCOPE, 'stream_abc123');

      expect(view.peakViewerCount).toBe(3);
      expect(prisma.liveStream.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { peakViewerCount: 3 } }),
      );
    });

    it('never lowers a stored peak just because fewer viewers are live right now', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ peakViewerCount: 10 }));
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      prisma.room.findUnique.mockResolvedValue({ name: 'stream_abc123' });
      sfuRoomState.listLiveParticipants.mockResolvedValue([
        { identity: 'a', joinedAt: new Date(), tracks: [] },
      ]);

      const view = await service.get(SCOPE, 'stream_abc123');

      expect(view.peakViewerCount).toBe(10);
      expect(prisma.liveStream.update).not.toHaveBeenCalled();
    });
  });
});
