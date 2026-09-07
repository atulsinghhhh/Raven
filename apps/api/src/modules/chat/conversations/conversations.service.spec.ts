import { ChatMemberRole, ChatMemberStatus, ConversationType } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ConflictError } from '../../../shared/errors/app-error';
import { Environment } from '../../../shared/environment/environment.constants';
import { WebhookEventsService } from '../../webhooks/webhook-events.service';
import { ConversationsService } from './conversations.service';

/**
 * Covers the webhook events this service is responsible for firing —
 * `room.created`, `participant.joined`, `participant.left` — the three
 * the event catalogue (docs/reference/events.md) documents as delivered
 * but that, before this, no code path actually emitted.
 *
 * Mirrors WebhookEventsService's own spec: a hand-rolled Prisma stub
 * rather than a real database, since what's under test is which events
 * fire with which payload, not Prisma itself.
 */
describe('ConversationsService — webhook events', () => {
  let service: ConversationsService;
  let prisma: {
    conversation: { findUnique: jest.Mock; create: jest.Mock };
    room: { findUnique: jest.Mock };
    chatMember: { upsert: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let webhooks: { emit: jest.Mock };

  const SCOPE = { projectId: 'p1', environment: Environment.DEVELOPMENT };

  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn(), create: jest.fn() },
      room: { findUnique: jest.fn() },
      chatMember: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    webhooks = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      webhooks as unknown as WebhookEventsService,
    );
  });

  describe('create()', () => {
    it('emits room.created with the conversation identity, not the database id', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null); // name collision check
      prisma.conversation.create.mockResolvedValue({
        id: 'internal-uuid',
        publicId: 'conv_abc',
        name: 'support',
        type: ConversationType.CHANNEL,
        roomId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.create(SCOPE, { name: 'support' });

      expect(webhooks.emit).toHaveBeenCalledWith(SCOPE, 'room.created', {
        roomId: 'conv_abc',
        name: 'support',
        type: ConversationType.CHANNEL,
        rtcRoomId: null,
        rtcRoomName: undefined,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('includes the linked RTC room name when the conversation attaches to one', async () => {
      prisma.conversation.findUnique
        .mockResolvedValueOnce(null) // name collision
        .mockResolvedValueOnce(null); // roomId already linked?
      prisma.room.findUnique.mockResolvedValue({
        id: 'room-uuid',
        projectId: 'p1',
        environment: Environment.DEVELOPMENT,
        name: 'lobby',
      });
      prisma.conversation.create.mockResolvedValue({
        id: 'internal-uuid',
        publicId: 'conv_xyz',
        name: 'lobby',
        type: ConversationType.ROOM,
        roomId: 'room-uuid',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.create(SCOPE, { name: 'lobby', roomId: 'room-uuid' });

      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'room.created',
        expect.objectContaining({ rtcRoomId: 'room-uuid', rtcRoomName: 'lobby' }),
      );
    });

    it('never emits before the conversation is durably stored', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      const createOrder: string[] = [];
      prisma.conversation.create.mockImplementation(async () => {
        createOrder.push('create');
        return {
          id: 'u1',
          publicId: 'conv_1',
          name: 'x',
          type: ConversationType.CHANNEL,
          roomId: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      });
      webhooks.emit.mockImplementation(async () => {
        createOrder.push('emit');
      });

      await service.create(SCOPE, { name: 'x' });

      expect(createOrder).toEqual(['create', 'emit']);
    });

    it('turns a concurrent duplicate-name race into a clean ConflictError, not a raw Prisma error', async () => {
      // The findUnique pre-check is a classic check-then-act race: two
      // concurrent requests for the same name can both pass it, then both
      // reach prisma.conversation.create — the loser must see the same
      // ConflictError the pre-check itself throws, not an unhandled 500.
      prisma.conversation.findUnique.mockResolvedValue(null);
      prisma.conversation.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed on the fields: (`projectId`,`environment`,`name`)'), {
          code: 'P2002',
        }),
      );

      await expect(service.create(SCOPE, { name: 'general' })).rejects.toBeInstanceOf(ConflictError);
      expect(webhooks.emit).not.toHaveBeenCalled();
    });
  });

  describe('addMember()', () => {
    it('emits participant.joined with the role actually assigned', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'internal-uuid',
        publicId: 'conv_abc',
        projectId: 'p1',
        environment: Environment.DEVELOPMENT,
      });
      prisma.chatMember.upsert.mockResolvedValue({
        userId: 'user_1',
        role: ChatMemberRole.ADMIN,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.addMember(SCOPE, 'conv_abc', { userId: 'user_1', role: ChatMemberRole.ADMIN });

      expect(webhooks.emit).toHaveBeenCalledWith(SCOPE, 'participant.joined', {
        roomId: 'conv_abc',
        userId: 'user_1',
        role: ChatMemberRole.ADMIN,
        at: '2026-01-01T00:00:00.000Z',
      });
    });

    it('defaults an unspecified role to MEMBER in the emitted payload, matching what was stored', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'internal-uuid',
        publicId: 'conv_abc',
        projectId: 'p1',
        environment: Environment.DEVELOPMENT,
      });
      prisma.chatMember.upsert.mockResolvedValue({
        userId: 'user_2',
        role: ChatMemberRole.MEMBER,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.addMember(SCOPE, 'conv_abc', { userId: 'user_2' });

      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'participant.joined',
        expect.objectContaining({ role: ChatMemberRole.MEMBER }),
      );
    });
  });

  describe('removeMember()', () => {
    it('emits participant.left for a member who is actually removed', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'internal-uuid',
        publicId: 'conv_abc',
        projectId: 'p1',
        environment: Environment.DEVELOPMENT,
      });
      prisma.chatMember.findUnique.mockResolvedValue({
        id: 'member-uuid',
        userId: 'user_1',
        role: ChatMemberRole.MEMBER,
        status: ChatMemberStatus.ACTIVE,
      });
      prisma.chatMember.update.mockResolvedValue({
        userId: 'user_1',
        role: ChatMemberRole.MEMBER,
        leftAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      await service.removeMember(SCOPE, 'conv_abc', 'user_1');

      expect(webhooks.emit).toHaveBeenCalledWith(SCOPE, 'participant.left', {
        roomId: 'conv_abc',
        userId: 'user_1',
        role: ChatMemberRole.MEMBER,
        at: '2026-01-02T00:00:00.000Z',
      });
    });

    it('never emits when there is no such member — nothing was removed', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'internal-uuid',
        publicId: 'conv_abc',
        projectId: 'p1',
        environment: Environment.DEVELOPMENT,
      });
      prisma.chatMember.findUnique.mockResolvedValue(null);

      await expect(service.removeMember(SCOPE, 'conv_abc', 'ghost')).rejects.toThrow();
      expect(webhooks.emit).not.toHaveBeenCalled();
    });
  });
});
