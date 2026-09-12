import {
  ChatMemberRole,
  ConversationStatus,
  LiveStreamDeliveryMode,
  LiveStreamEgressStatus,
  LiveStreamHostRole,
  LiveStreamStatus,
  LiveStreamVisibility,
} from '../../generated/prisma/client';
import { Logger } from '@nestjs/common';
import { AppError, ConflictError } from '../../shared/errors/app-error';
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
    liveStream: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    liveStreamHost: {
      create: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    room: { findUnique: jest.Mock };
    conversation: { findUnique: jest.Mock; update: jest.Mock };
    project: { findUnique: jest.Mock };
    liveStreamEgress: { findUnique: jest.Mock };
  };
  let roomsService: { create: jest.Mock; close: jest.Mock };
  let sfuRoomState: { listLiveParticipants: jest.Mock };
  let rtcTokensService: { mintRawCredential: jest.Mock };
  let conversationsService: { create: jest.Mock; addMember: jest.Mock; removeMember: jest.Mock };
  let messagesService: { send: jest.Mock };
  let chatTokenService: { issue: jest.Mock };
  let webhooks: { emit: jest.Mock };
  let usageAllowances: { assertProjectWithinAllowance: jest.Mock };
  let configService: { get: jest.Mock };
  let egressControl: { start: jest.Mock; stop: jest.Mock };

  const SCOPE = { projectId: 'p1', environment: Environment.DEVELOPMENT };
  const OTHER_PROJECT_SCOPE = { projectId: 'p2', environment: Environment.DEVELOPMENT };

  const baseStream = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'stream-internal-uuid',
    publicId: 'stream_abc123',
    projectId: 'p1',
    ownerId: 'owner-1',
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
    deliveryMode: LiveStreamDeliveryMode.RTC_ONLY,
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
      liveStream: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        // A lifecycle transition is a conditional write, so the default is
        // "this caller won the transition". Tests that model a lost race
        // override it with { count: 0 }.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      liveStreamHost: {
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      },
      room: { findUnique: jest.fn() },
      conversation: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      project: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) },
      liveStreamEgress: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    roomsService = {
      create: jest.fn().mockResolvedValue({ id: 'room-uuid', name: 'stream_abc123' }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    sfuRoomState = { listLiveParticipants: jest.fn() };
    rtcTokensService = { mintRawCredential: jest.fn().mockResolvedValue({ token: 'rtc-jwt', endpoint: 'ws://x' }) };
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
    usageAllowances = { assertProjectWithinAllowance: jest.fn().mockResolvedValue(undefined) };
    egressControl = { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
    const configValues: Record<string, unknown> = {
      'usage.reaperIntervalMs': 60_000,
      'usage.live.maxConcurrentStreams': 1,
      'usage.live.maxViewers': 100,
      'usage.live.maxStreamDurationMinutes': 240,
    };
    configService = { get: jest.fn((key: string) => configValues[key]) };

    service = new LiveStreamsService(
      prisma as never,
      roomsService as never,
      sfuRoomState as never,
      rtcTokensService as never,
      conversationsService as never,
      messagesService as never,
      chatTokenService as never,
      webhooks as never,
      usageAllowances as never,
      configService as never,
      egressControl as never,
    );
  });

  describe('create()', () => {
    it('creates a dedicated room and an attached conversation, not a developer-supplied one', async () => {
      prisma.liveStream.create.mockResolvedValue(baseStream({ hosts: [] }));
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' });

      expect(roomsService.create).toHaveBeenCalledWith(SCOPE, { name: expect.stringMatching(/^stream_/) });
      expect(conversationsService.create).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ roomId: 'room-uuid' }));
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

    /**
     * P0 regression: the system root message create() posts is Livqeno's
     * own bookkeeping, not developer-authored chat traffic. A prior change
     * gated every message send behind the project owner's Chat allowance,
     * which meant a project with its (entirely unrelated) Chat quota spent
     * could never create a live stream again — the system message send
     * would reject, after the room and conversation already existed. The
     * actor create() builds for that send must always be marked internal
     * so MessagesService.send() exempts it from that check.
     */
    it('marks the system root-message actor internal, so it is exempt from the Chat usage allowance', async () => {
      prisma.liveStream.create.mockResolvedValue(baseStream({ hosts: [] }));
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' });

      const [actor] = messagesService.send.mock.calls[0];
      expect(actor).toMatchObject({ kind: 'server', internal: true });
    });

    /**
     * P0 regression: create() calls roomsService.create(), then
     * conversationsService.create(), then messagesService.send(), then
     * finally writes the LiveStream row. Nothing wrapped those in a
     * transaction or any cleanup, so a failure at any step after the room
     * existed left it — and any conversation already attached to it —
     * permanently orphaned: never closed, never archived, invisible to
     * every stream a developer could see.
     */
    describe('cleanup when creation fails after infrastructure already exists', () => {
      it('closes the room and archives the conversation when the system message send fails', async () => {
        prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });
        const failure = new Error('boom');
        messagesService.send.mockRejectedValue(failure);

        await expect(service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' })).rejects.toBe(failure);

        expect(roomsService.close).toHaveBeenCalledWith('room-uuid', SCOPE);
        expect(prisma.conversation.update).toHaveBeenCalledWith({
          where: { id: 'conv-uuid' },
          data: { status: ConversationStatus.ARCHIVED },
        });
        expect(prisma.liveStream.create).not.toHaveBeenCalled();
      });

      it('closes only the room when conversation creation itself fails', async () => {
        const failure = new Error('conversation name already taken');
        conversationsService.create.mockRejectedValue(failure);

        await expect(service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' })).rejects.toBe(failure);

        expect(roomsService.close).toHaveBeenCalledWith('room-uuid', SCOPE);
        expect(prisma.conversation.update).not.toHaveBeenCalled();
      });

      it('closes the room and archives the conversation when the final LiveStream write fails', async () => {
        prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });
        const failure = Object.assign(new Error('column "ownerId" does not exist'), { code: '42703' });
        prisma.liveStream.create.mockRejectedValue(failure);

        await expect(service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' })).rejects.toBe(failure);

        expect(roomsService.close).toHaveBeenCalledWith('room-uuid', SCOPE);
        expect(prisma.conversation.update).toHaveBeenCalledWith({
          where: { id: 'conv-uuid' },
          data: { status: ConversationStatus.ARCHIVED },
        });
      });

      it('still surfaces the original error even when the room cleanup itself fails', async () => {
        prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });
        const failure = new Error('boom');
        messagesService.send.mockRejectedValue(failure);
        roomsService.close.mockRejectedValue(new Error('SFU unreachable'));

        await expect(service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' })).rejects.toBe(failure);
      });

      it('never leaves cleanup running for a stream that was actually created', async () => {
        prisma.liveStream.create.mockResolvedValue(baseStream({ hosts: [] }));
        prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

        await service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' });

        expect(roomsService.close).not.toHaveBeenCalled();
        expect(prisma.conversation.update).not.toHaveBeenCalled();
      });
    });

    /** Step 6, Test C: sequential creations must not collide or leak state between calls. */
    it('creates multiple streams in a row without collision or leftover state', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });
      roomsService.create
        .mockResolvedValueOnce({ id: 'room-1', name: 'stream_1' })
        .mockResolvedValueOnce({ id: 'room-2', name: 'stream_2' })
        .mockResolvedValueOnce({ id: 'room-3', name: 'stream_3' });
      prisma.liveStream.create
        .mockResolvedValueOnce(baseStream({ id: 's1', publicId: 'stream_1', roomId: 'room-1', hosts: [] }))
        .mockResolvedValueOnce(baseStream({ id: 's2', publicId: 'stream_2', roomId: 'room-2', hosts: [] }))
        .mockResolvedValueOnce(baseStream({ id: 's3', publicId: 'stream_3', roomId: 'room-3', hosts: [] }));

      const results = await Promise.all(
        [1, 2, 3].map(() => service.create(SCOPE, { title: 'My Stream', hostIdentity: 'alice' })),
      );

      expect(results.map((r) => r.id)).toEqual(['stream_1', 'stream_2', 'stream_3']);
      expect(roomsService.close).not.toHaveBeenCalled();
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

      expect(prisma.liveStream.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: LiveStreamStatus.CREATED }),
          data: expect.objectContaining({ status: LiveStreamStatus.LIVE }),
        }),
      );
      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.started',
        expect.objectContaining({ streamId: 'stream_abc123' }),
      );
    });

    it('rejects starting a stream that is already LIVE', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE }));
      prisma.liveStream.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.start(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
      expect(webhooks.emit).not.toHaveBeenCalled();
    });

    it('rejects starting a stream that has already ENDED', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));
      prisma.liveStream.updateMany.mockResolvedValue({ count: 0 });

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
      prisma.liveStream.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.end(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
      expect(roomsService.close).not.toHaveBeenCalled();
    });

    it('rejects ending a stream that has already ENDED — no ENDED to LIVE resurrection path exists', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));
      prisma.liveStream.updateMany.mockResolvedValue({ count: 0 });

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

    describe('free-tier concurrency cap', () => {
      it('translates a live_streams_one_live_per_owner unique violation into STREAM_CONCURRENCY_LIMIT_EXCEEDED', async () => {
        prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.CREATED }));
        prisma.liveStream.updateMany.mockRejectedValue(
          Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
        );

        await expect(service.start(SCOPE, 'stream_abc123')).rejects.toMatchObject({
          code: RavenErrorCode.STREAM_CONCURRENCY_LIMIT_EXCEEDED,
        });
      });

      it('does not mistake an unrelated database error for the concurrency cap', async () => {
        prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.CREATED }));
        const dbError = new Error('connection reset');
        prisma.liveStream.updateMany.mockRejectedValue(dbError);

        await expect(service.start(SCOPE, 'stream_abc123')).rejects.toBe(dbError);
      });
    });
  });

  describe('reapOverdueStreams() — free-tier duration cap', () => {
    it('ends every stream still LIVE past the configured max duration', async () => {
      const rows = [
        { id: 'overdue-1', projectId: 'p1', environment: Environment.DEVELOPMENT },
        { id: 'overdue-2', projectId: 'p2', environment: Environment.PRODUCTION },
      ];
      prisma.liveStream.findMany.mockResolvedValue(rows);
      const endSpy = jest.spyOn(service, 'end').mockResolvedValue({} as never);

      const result = await service.reapOverdueStreams();

      expect(prisma.liveStream.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: LiveStreamStatus.LIVE,
            startedAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        }),
      );
      expect(endSpy).toHaveBeenCalledTimes(2);
      expect(endSpy).toHaveBeenNthCalledWith(
        1,
        { projectId: 'p1', environment: Environment.DEVELOPMENT },
        'overdue-1',
        { reason: 'duration_cap_reached' },
      );
      expect(endSpy).toHaveBeenNthCalledWith(2, { projectId: 'p2', environment: Environment.PRODUCTION }, 'overdue-2', {
        reason: 'duration_cap_reached',
      });
      expect(result.ended).toBe(2);
    });

    it('continues the pass when one stream lost a race to end on its own', async () => {
      prisma.liveStream.findMany.mockResolvedValue([
        { id: 'overdue-1', projectId: 'p1', environment: Environment.DEVELOPMENT },
        { id: 'overdue-2', projectId: 'p1', environment: Environment.DEVELOPMENT },
      ]);
      jest
        .spyOn(service, 'end')
        .mockRejectedValueOnce(new ConflictError('already ENDED', RavenErrorCode.STREAM_INVALID_STATE))
        .mockResolvedValueOnce({} as never);

      const result = await service.reapOverdueStreams();

      expect(result.ended).toBe(1);
    });
  });

  describe('addHost() — host/co-host credentials', () => {
    beforeEach(() => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-uuid', publicId: 'conv_xyz789' });
    });

    it('mints an RTC token with full publish permissions', async () => {
      prisma.liveStreamHost.create.mockResolvedValue({
        identity: 'bob',
        role: LiveStreamHostRole.CO_HOST,
        invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' });

      expect(rtcTokensService.mintRawCredential).toHaveBeenCalledWith(
        SCOPE,
        'room-uuid',
        expect.objectContaining({
          participantIdentity: 'bob',
          permissions: expect.objectContaining({ publish: true, publishAudio: true, publishVideo: true }),
        }),
      );
    });

    it('grants MODERATOR chat role for a CO_HOST, ADMIN for a HOST', async () => {
      prisma.liveStreamHost.create.mockResolvedValueOnce({
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

      prisma.liveStreamHost.create.mockResolvedValueOnce({
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
      prisma.liveStreamHost.create.mockResolvedValue({
        identity: 'bob',
        role: LiveStreamHostRole.CO_HOST,
        invitedAt: new Date(),
      });

      await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' });

      expect(prisma.liveStreamHost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: LiveStreamHostRole.CO_HOST }),
        }),
      );
    });

    it('emits live_stream.host_joined with the role actually assigned', async () => {
      prisma.liveStreamHost.create.mockResolvedValue({
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
      expect(rtcTokensService.mintRawCredential).not.toHaveBeenCalled();
    });

    /**
     * The quickstart calls `create({ hostIdentity: 'alice' })` and then
     * `addHost(streamId, { identity: 'alice' })` to mint alice her
     * credentials. Applying the CO_HOST default to that existing row
     * demoted her, left the stream with no HOST, and dropped
     * `chat:manage` from the token it handed back.
     */
    describe('re-registering an identity that is already a host', () => {
      it('keeps their existing role when no role is given', async () => {
        prisma.liveStreamHost.findUnique.mockResolvedValue({
          identity: 'alice',
          role: LiveStreamHostRole.HOST,
          invitedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        prisma.liveStreamHost.update.mockResolvedValue({
          identity: 'alice',
          role: LiveStreamHostRole.HOST,
          invitedAt: new Date('2026-01-01T00:00:00.000Z'),
        });

        const credential = await service.addHost(SCOPE, 'stream_abc123', { identity: 'alice' });

        expect(prisma.liveStreamHost.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ role: LiveStreamHostRole.HOST }) }),
        );
        expect(credential.role).toBe(LiveStreamHostRole.HOST);
      });

      it('still hands a re-minted HOST an ADMIN chat role', async () => {
        prisma.liveStreamHost.findUnique.mockResolvedValue({
          identity: 'alice',
          role: LiveStreamHostRole.HOST,
          invitedAt: new Date(),
        });
        prisma.liveStreamHost.update.mockResolvedValue({
          identity: 'alice',
          role: LiveStreamHostRole.HOST,
          invitedAt: new Date(),
        });

        await service.addHost(SCOPE, 'stream_abc123', { identity: 'alice' });

        expect(conversationsService.addMember).toHaveBeenCalledWith(
          SCOPE,
          'conv_xyz789',
          expect.objectContaining({ role: ChatMemberRole.ADMIN }),
        );
      });

      it('still honours an explicit role change', async () => {
        prisma.liveStreamHost.findUnique.mockResolvedValue({
          identity: 'alice',
          role: LiveStreamHostRole.HOST,
          invitedAt: new Date(),
        });
        prisma.liveStreamHost.update.mockResolvedValue({
          identity: 'alice',
          role: LiveStreamHostRole.CO_HOST,
          invitedAt: new Date(),
        });

        await service.addHost(SCOPE, 'stream_abc123', {
          identity: 'alice',
          role: LiveStreamHostRole.CO_HOST,
        });

        expect(prisma.liveStreamHost.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ role: LiveStreamHostRole.CO_HOST }) }),
        );
      });

      it('reactivates a soft-removed host rather than orphaning their row', async () => {
        prisma.liveStreamHost.findUnique.mockResolvedValue({
          identity: 'bob',
          role: LiveStreamHostRole.CO_HOST,
          invitedAt: new Date(),
          removedAt: new Date(),
        });
        prisma.liveStreamHost.update.mockResolvedValue({
          identity: 'bob',
          role: LiveStreamHostRole.CO_HOST,
          invitedAt: new Date(),
        });

        await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' });

        expect(prisma.liveStreamHost.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ removedAt: null }) }),
        );
      });
    });

    /**
     * Two simultaneous calls for one identity both see no row and both
     * insert; the loser hits `@@unique([streamId, identity])`. That used to
     * escape as a 500, which is the wrong answer to a race whose winner
     * wrote exactly the row this caller wanted.
     */
    it('recovers from losing the insert race instead of failing the request', async () => {
      const winner = {
        identity: 'bob',
        role: LiveStreamHostRole.CO_HOST,
        invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      prisma.liveStreamHost.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      prisma.liveStreamHost.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
      prisma.liveStreamHost.update.mockResolvedValue(winner);

      const credential = await service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' });

      expect(credential.role).toBe(LiveStreamHostRole.CO_HOST);
      expect(rtcTokensService.mintRawCredential).toHaveBeenCalled();
    });

    it('rethrows a create failure that is not a lost race', async () => {
      prisma.liveStreamHost.findUnique.mockResolvedValue(null);
      prisma.liveStreamHost.create.mockRejectedValue(new Error('connection reset'));

      await expect(service.addHost(SCOPE, 'stream_abc123', { identity: 'bob' })).rejects.toThrow('connection reset');
    });
  });

  /**
   * Reading the row, deciding, then writing left a gap wide enough that
   * five concurrent start() calls all read CREATED and all wrote LIVE.
   * The status is part of the WHERE now, so the database picks the winner.
   */
  describe('lifecycle transitions are conditional writes, not read-then-write', () => {
    it('start() guards the update on the stream still being CREATED', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.CREATED }));
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.start(SCOPE, 'stream_abc123');

      expect(prisma.liveStream.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: LiveStreamStatus.CREATED }) }),
      );
    });

    it('end() guards the update on the stream still being LIVE', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE }));
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.end(SCOPE, 'stream_abc123');

      expect(prisma.liveStream.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: LiveStreamStatus.LIVE }) }),
      );
    });

    it('a start() that matched no row emits nothing and conflicts', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.CREATED }));
      prisma.liveStream.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.start(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
      expect(webhooks.emit).not.toHaveBeenCalled();
    });

    it('an end() that matched no row emits nothing and leaves the room alone', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE }));
      prisma.liveStream.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.end(SCOPE, 'stream_abc123')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_INVALID_STATE,
      });
      expect(webhooks.emit).not.toHaveBeenCalled();
      expect(roomsService.close).not.toHaveBeenCalled();
    });
  });

  describe('createViewerToken() — never trusts a client into becoming a host', () => {
    beforeEach(() => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-uuid', publicId: 'conv_xyz789' });
    });

    it('always mints subscribe-only RTC permissions', async () => {
      await service.createViewerToken(SCOPE, 'stream_abc123', 'dave');

      expect(rtcTokensService.mintRawCredential).toHaveBeenCalledWith(
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
      const [, , tokenDto] = rtcTokensService.mintRawCredential.mock.calls[0];
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

    describe('free-tier viewer cap', () => {
      beforeEach(() => {
        prisma.liveStreamHost.findMany.mockResolvedValue([
          { identity: 'alice', role: LiveStreamHostRole.HOST, removedAt: null },
        ]);
      });

      it('rejects the 101st viewer once the cap is reached', async () => {
        // 100 non-host participants already live — alice (the host) is
        // excluded from the viewer count the same way toView() excludes her.
        sfuRoomState.listLiveParticipants.mockResolvedValue(
          Array.from({ length: 100 }, (_, i) => ({ identity: `viewer-${i}` })),
        );

        await expect(service.createViewerToken(SCOPE, 'stream_abc123', 'viewer-100')).rejects.toMatchObject({
          code: RavenErrorCode.STREAM_VIEWER_LIMIT_EXCEEDED,
        });
        expect(rtcTokensService.mintRawCredential).not.toHaveBeenCalled();
      });

      it('admits a viewer under the cap', async () => {
        sfuRoomState.listLiveParticipants.mockResolvedValue(
          Array.from({ length: 99 }, (_, i) => ({ identity: `viewer-${i}` })),
        );

        await expect(service.createViewerToken(SCOPE, 'stream_abc123', 'viewer-99')).resolves.toBeDefined();
      });

      it('fails open — mints anyway — when the SFU is unreachable', async () => {
        // listLiveParticipants() returns undefined on an SFU fault, the
        // same signal toView() treats as "viewer count unknown," not zero.
        sfuRoomState.listLiveParticipants.mockResolvedValue(undefined);

        await expect(service.createViewerToken(SCOPE, 'stream_abc123', 'dave')).resolves.toBeDefined();
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
      expect(prisma.liveStream.update).toHaveBeenCalledWith(expect.objectContaining({ data: { peakViewerCount: 3 } }));
    });

    it('never lowers a stored peak just because fewer viewers are live right now', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ peakViewerCount: 10 }));
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      prisma.room.findUnique.mockResolvedValue({ name: 'stream_abc123' });
      sfuRoomState.listLiveParticipants.mockResolvedValue([{ identity: 'a', joinedAt: new Date(), tracks: [] }]);

      const view = await service.get(SCOPE, 'stream_abc123');

      expect(view.peakViewerCount).toBe(10);
      expect(prisma.liveStream.update).not.toHaveBeenCalled();
    });

    it('excludes the egress worker\'s reserved identity from the viewer count', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(
        baseStream({ deliveryMode: LiveStreamDeliveryMode.BROADCAST }),
      );
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      prisma.liveStreamEgress.findUnique.mockResolvedValue(null);
      prisma.room.findUnique.mockResolvedValue({ name: 'stream_abc123' });
      sfuRoomState.listLiveParticipants.mockResolvedValue([
        { identity: 'egress-stream_abc123', joinedAt: new Date(), tracks: [] },
        { identity: 'dave', joinedAt: new Date(), tracks: [] },
      ]);

      const view = await service.get(SCOPE, 'stream_abc123');

      expect(view.viewerCount).toBe(1);
    });
  });

  describe('broadcast delivery (deliveryMode: BROADCAST)', () => {
    it('passes an explicit deliveryMode through to the created row', async () => {
      prisma.liveStream.create.mockResolvedValue(
        baseStream({ hosts: [], deliveryMode: LiveStreamDeliveryMode.BROADCAST }),
      );
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await service.create(SCOPE, {
        title: 'A broadcast',
        hostIdentity: 'alice',
        deliveryMode: LiveStreamDeliveryMode.BROADCAST,
      } as never);

      expect(prisma.liveStream.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deliveryMode: LiveStreamDeliveryMode.BROADCAST }) }),
      );
    });

    it('start() kicks off egress for a BROADCAST stream, but never for an RTC_ONLY one', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(
        baseStream({ status: LiveStreamStatus.CREATED, deliveryMode: LiveStreamDeliveryMode.BROADCAST }),
      );
      prisma.liveStream.update.mockResolvedValue(
        baseStream({ status: LiveStreamStatus.LIVE, deliveryMode: LiveStreamDeliveryMode.BROADCAST }),
      );
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      prisma.liveStreamEgress.findUnique.mockResolvedValue(null);

      await service.start(SCOPE, 'stream_abc123');
      // start() fires egress.start() with `void` — flush the microtask queue
      // so the fire-and-forget call has actually been made before asserting.
      await Promise.resolve();

      expect(egressControl.start).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ id: 'stream-internal-uuid' }));
    });

    it('never calls egress.start() for an RTC_ONLY stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.CREATED }));
      prisma.liveStream.update.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE }));
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.start(SCOPE, 'stream_abc123');
      await Promise.resolve();

      expect(egressControl.start).not.toHaveBeenCalled();
    });

    it('end() stops egress for a BROADCAST stream that had it running', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(
        baseStream({ status: LiveStreamStatus.LIVE, deliveryMode: LiveStreamDeliveryMode.BROADCAST }),
      );
      prisma.liveStream.update.mockResolvedValue(
        baseStream({ status: LiveStreamStatus.ENDED, deliveryMode: LiveStreamDeliveryMode.BROADCAST }),
      );
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      prisma.liveStreamEgress.findUnique.mockResolvedValue(null);

      await service.end(SCOPE, 'stream_abc123');

      expect(egressControl.stop).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ id: 'stream-internal-uuid' }));
    });

    it('never calls egress.stop() for an RTC_ONLY stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE }));
      prisma.liveStream.update.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));
      prisma.liveStreamHost.findMany.mockResolvedValue([]);

      await service.end(SCOPE, 'stream_abc123');

      expect(egressControl.stop).not.toHaveBeenCalled();
    });

    it('createViewerToken() refuses a BROADCAST stream instead of minting an RTC viewer credential', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(
        baseStream({ deliveryMode: LiveStreamDeliveryMode.BROADCAST }),
      );

      await expect(service.createViewerToken(SCOPE, 'stream_abc123', 'dave')).rejects.toMatchObject({
        code: RavenErrorCode.STREAM_DELIVERY_MODE_MISMATCH,
      });
      expect(rtcTokensService.mintRawCredential).not.toHaveBeenCalled();
    });

    it('createViewerToken() is unaffected for an RTC_ONLY stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.room.findUnique.mockResolvedValue({ name: 'stream_abc123' });
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      sfuRoomState.listLiveParticipants.mockResolvedValue([]);
      prisma.conversation.findUnique.mockResolvedValue({ publicId: 'conv_xyz789' });

      await expect(service.createViewerToken(SCOPE, 'stream_abc123', 'dave')).resolves.toMatchObject({
        role: 'VIEWER',
      });
    });

    describe('getPlaybackInfo()', () => {
      it('returns NOT_APPLICABLE and never touches LiveStreamEgress for an RTC_ONLY stream', async () => {
        prisma.liveStream.findUnique.mockResolvedValue(baseStream());

        const delivery = await service.getPlaybackInfo(SCOPE, 'stream_abc123');

        expect(delivery).toEqual({ mode: LiveStreamDeliveryMode.RTC_ONLY, status: 'NOT_APPLICABLE', playbackUrl: null });
        expect(prisma.liveStreamEgress.findUnique).not.toHaveBeenCalled();
      });

      it('reports NOT_STARTED for a BROADCAST stream with no egress row yet', async () => {
        prisma.liveStream.findUnique.mockResolvedValue(baseStream({ deliveryMode: LiveStreamDeliveryMode.BROADCAST }));
        prisma.liveStreamEgress.findUnique.mockResolvedValue(null);

        const delivery = await service.getPlaybackInfo(SCOPE, 'stream_abc123');

        expect(delivery).toEqual({ mode: LiveStreamDeliveryMode.BROADCAST, status: 'NOT_STARTED', playbackUrl: null });
      });

      it('maps RUNNING to READY with the playback URL, once egress reports it', async () => {
        prisma.liveStream.findUnique.mockResolvedValue(baseStream({ deliveryMode: LiveStreamDeliveryMode.BROADCAST }));
        prisma.liveStreamEgress.findUnique.mockResolvedValue({
          status: LiveStreamEgressStatus.RUNNING,
          playbackUrl: 'https://cdn.example.com/live/stream_abc123/index.m3u8',
        });

        const delivery = await service.getPlaybackInfo(SCOPE, 'stream_abc123');

        expect(delivery).toEqual({
          mode: LiveStreamDeliveryMode.BROADCAST,
          status: 'READY',
          playbackUrl: 'https://cdn.example.com/live/stream_abc123/index.m3u8',
        });
      });

      it('maps FAILED to FAILED', async () => {
        prisma.liveStream.findUnique.mockResolvedValue(baseStream({ deliveryMode: LiveStreamDeliveryMode.BROADCAST }));
        prisma.liveStreamEgress.findUnique.mockResolvedValue({
          status: LiveStreamEgressStatus.FAILED,
          playbackUrl: null,
        });

        const delivery = await service.getPlaybackInfo(SCOPE, 'stream_abc123');

        expect(delivery.status).toBe('FAILED');
      });

      it('maps STOPPING/STOPPED to ENDED', async () => {
        prisma.liveStream.findUnique.mockResolvedValue(baseStream({ deliveryMode: LiveStreamDeliveryMode.BROADCAST }));
        prisma.liveStreamEgress.findUnique.mockResolvedValue({
          status: LiveStreamEgressStatus.STOPPED,
          playbackUrl: 'https://cdn.example.com/live/stream_abc123/index.m3u8',
        });

        const delivery = await service.getPlaybackInfo(SCOPE, 'stream_abc123');

        expect(delivery.status).toBe('ENDED');
      });
    });
  });

  /**
   * Lifecycle logging (see `LiveStreamsService.event`).
   *
   * Live Streaming had no server-side logging whatsoever, which made "why
   * did this stream fail" unanswerable from the API's own output. These
   * assert both halves of fixing that: the identifiers an operator needs
   * are present, and the credentials they must never see are not.
   */
  describe('observability', () => {
    /** Captures everything written at every level, in one place. */
    function captureLogs() {
      const lines: string[] = [];
      const record = (message: unknown) => {
        lines.push(String(message));
      };
      const spies = [
        jest.spyOn(Logger.prototype, 'log').mockImplementation(record),
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(record),
        jest.spyOn(Logger.prototype, 'error').mockImplementation(record),
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(record),
      ];
      return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
    }

    it('records the identifiers needed to correlate a stream across planes', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.liveStream.updateMany.mockResolvedValue({ count: 1 });
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      const captured = captureLogs();

      try {
        await service.start(SCOPE, 'stream_abc123');
      } finally {
        captured.restore();
      }

      const line = captured.lines.find((entry) => entry.includes('stream.started'));
      expect(line).toBeDefined();
      // Project and environment are what make a line attributable at all in
      // a multi-tenant log stream; stream and room are what join it to the
      // media plane's own lines.
      expect(line).toContain('project=p1');
      expect(line).toContain('env=DEVELOPMENT');
      expect(line).toContain('stream=stream_abc123');
      expect(line).toContain('room=room-uuid');
    });

    it('never writes a minted token to the log', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream());
      prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-uuid', publicId: 'conv_xyz789' });
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      const captured = captureLogs();

      try {
        // The viewer path mints both an RTC and a chat credential, so one
        // call covers both token kinds.
        await service.createViewerToken(SCOPE, 'stream_abc123', 'dave');
      } finally {
        captured.restore();
      }

      // These lines outlive the credential's TTL by months. A token in a
      // log file is a credential in a log file.
      const all = captured.lines.join('\n');
      expect(all).not.toContain('rtc-jwt');
      expect(all).not.toContain('chat-jwt');
      // The identity is deliberately present — it is the developer's own
      // opaque handle, authorizes nothing, and is the only way to trace one
      // viewer who complained.
      expect(all).toContain('identity=dave');
    });

    it('says what was attempted against an already-ended stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.ENDED }));
      const captured = captureLogs();

      try {
        await expect(service.createViewerToken(SCOPE, 'stream_abc123', 'dave')).rejects.toBeInstanceOf(ConflictError);
      } finally {
        captured.restore();
      }

      // The most-asked operational question in Live Streaming is "why are
      // my viewers getting 409?", and the usual answer is a client still
      // minting against a stream the host ended. Invisible without this.
      const line = captured.lines.find((entry) => entry.includes('stream.rejected_after_end'));
      expect(line).toBeDefined();
      expect(line).toContain('attempted=createViewerToken');
      expect(line).toContain('reason=stream already ENDED');
    });

    it('records why a lost start/end race was refused', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE }));
      prisma.liveStream.updateMany.mockResolvedValue({ count: 0 });
      const captured = captureLogs();

      try {
        await expect(service.start(SCOPE, 'stream_abc123')).rejects.toBeInstanceOf(ConflictError);
      } finally {
        captured.restore();
      }

      const line = captured.lines.find((entry) => entry.includes('stream.start_rejected'));
      expect(line).toBeDefined();
      expect(line).toContain('reason=already LIVE');
    });

    it('logs how long a stream actually ran', async () => {
      const startedAt = new Date(Date.now() - 5_000);
      prisma.liveStream.findUnique.mockResolvedValue(baseStream({ status: LiveStreamStatus.LIVE, startedAt }));
      prisma.liveStream.updateMany.mockResolvedValue({ count: 1 });
      prisma.liveStreamHost.findMany.mockResolvedValue([]);
      const captured = captureLogs();

      try {
        await service.end(SCOPE, 'stream_abc123');
      } finally {
        captured.restore();
      }

      // A stream that ends seconds after starting failed, whatever status
      // the end call returned. This is the first number an operator wants.
      const line = captured.lines.find((entry) => entry.includes('stream.ended'));
      expect(line).toMatch(/durationMs=\d+/);
    });
  });
});
