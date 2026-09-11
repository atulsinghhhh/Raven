import { ConversationStatus, ConversationType, MessageType } from '../../../generated/prisma/client';
import { NotFoundError } from '../../../shared/errors/app-error';
import { DashboardChatController } from './dashboard-chat.controller';

/**
 * Covers the three conversation-detail endpoints: getConversation,
 * listConversationMembers, listConversationMessages: added so
 * "click a conversation" has somewhere to go (the list page previously
 * linked nowhere).
 *
 * The one invariant worth a dedicated test, not just incidental
 * coverage: listConversationMessages must never be able to leak
 * `content`, per this controller's own documented rule (spec §50). The
 * Prisma `select` is what actually enforces that: this test exists so
 * a future edit that widens the select trips a test, not a production
 * incident.
 */
describe('DashboardChatController — conversation detail', () => {
  let controller: DashboardChatController;
  let prisma: {
    conversation: { findUnique: jest.Mock; findFirst: jest.Mock };
    chatMember: { findMany: jest.Mock };
    message: { findMany: jest.Mock };
  };
  let projectsService: { authorize: jest.Mock };

  const USER = { id: 'user-1', email: 'dev@example.com' };
  const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn(), findFirst: jest.fn() },
      chatMember: { findMany: jest.fn() },
      message: { findMany: jest.fn() },
    };
    projectsService = { authorize: jest.fn().mockResolvedValue({ project: {}, role: 'OWNER' }) };

    controller = new DashboardChatController(
      prisma as never,
      projectsService as never,
      {} as never, // ChatMetricsService — unused by these three endpoints
      {} as never, // PresenceService
      {} as never, // ChatGateway
    );
  });

  describe('getConversation()', () => {
    it('checks project authorization before touching the database', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        publicId: 'conv_abc',
        name: 'support',
        type: ConversationType.CHANNEL,
        status: ConversationStatus.ACTIVE,
        roomId: null,
        retentionDays: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { messages: 3, members: 2 },
        messages: [],
      });

      await controller.getConversation(USER as never, PROJECT_ID, 'conv_abc');

      expect(projectsService.authorize).toHaveBeenCalledWith(PROJECT_ID, USER.id, 'chat:read');
    });

    it('scopes the lookup to this project, so a conversation from another project 404s', async () => {
      // findFirst's own where clause does the actual scoping; this
      // asserts the controller passes projectId into it rather than
      // trusting a bare publicId lookup.
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(controller.getConversation(USER as never, PROJECT_ID, 'conv_other_project')).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { publicId: 'conv_other_project', projectId: PROJECT_ID } }),
      );
    });

    it('returns the public id and derived counts, not the internal database row shape', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        publicId: 'conv_abc',
        name: 'support',
        type: ConversationType.CHANNEL,
        status: ConversationStatus.ACTIVE,
        roomId: null,
        retentionDays: 30,
        metadata: { tier: 'gold' },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        _count: { messages: 12, members: 4 },
        messages: [{ createdAt: new Date('2026-01-02T00:00:00.000Z'), senderId: 'user_2' }],
      });

      const result = await controller.getConversation(USER as never, PROJECT_ID, 'conv_abc');

      expect(result).toMatchObject({
        id: 'conv_abc',
        name: 'support',
        messageCount: 12,
        memberCount: 4,
        lastMessageSenderId: 'user_2',
        retentionDays: 30,
      });
      expect(result).not.toHaveProperty('publicId'); // renamed to `id`, not duplicated
    });
  });

  describe('listConversationMembers()', () => {
    it('404s for a conversation outside this project before querying members', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'internal-uuid', projectId: 'someone-elses-project' });

      await expect(controller.listConversationMembers(USER as never, PROJECT_ID, 'conv_abc')).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(prisma.chatMember.findMany).not.toHaveBeenCalled();
    });

    it('returns members without their internal row id', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'internal-uuid', projectId: PROJECT_ID });
      prisma.chatMember.findMany.mockResolvedValue([
        {
          id: 'member-row-uuid',
          userId: 'user_1',
          role: 'ADMIN',
          status: 'ACTIVE',
          joinedAt: new Date('2026-01-01T00:00:00.000Z'),
          leftAt: null,
        },
      ]);

      const result = await controller.listConversationMembers(USER as never, PROJECT_ID, 'conv_abc');

      expect(result).toEqual([
        { userId: 'user_1', role: 'ADMIN', status: 'ACTIVE', joinedAt: expect.any(Date), leftAt: null },
      ]);
      expect(result[0]).not.toHaveProperty('id');
    });
  });

  describe('listConversationMessages()', () => {
    beforeEach(() => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'internal-uuid', projectId: PROJECT_ID });
    });

    it('never selects message content — the query itself cannot return it', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await controller.listConversationMessages(USER as never, PROJECT_ID, 'conv_abc');

      const call = prisma.message.findMany.mock.calls[0][0];
      expect(call.select).toBeDefined();
      expect(call.select.content).toBeUndefined();
      expect(Object.keys(call.select)).not.toContain('content');
    });

    it('does not put content on the response even if the mock were to return it', async () => {
      // Belt and braces: even if some future refactor made the query
      // return a full row, the mapping step must not forward `content`.
      prisma.message.findMany.mockResolvedValue([
        {
          publicId: 'msg_1',
          senderId: 'user_1',
          type: MessageType.TEXT,
          content: 'this must never reach the dashboard',
          replyToMessageId: null,
          threadRootId: null,
          editedAt: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          _count: { reactions: 0, attachments: 0 },
        },
      ]);

      const result = await controller.listConversationMessages(USER as never, PROJECT_ID, 'conv_abc');

      expect(result[0]).not.toHaveProperty('content');
      expect(JSON.stringify(result)).not.toContain('this must never reach the dashboard');
    });

    it('derives status from editedAt/deletedAt rather than a stored field', async () => {
      prisma.message.findMany.mockResolvedValue([
        {
          publicId: 'msg_sent',
          senderId: 'u1',
          type: MessageType.TEXT,
          createdAt: new Date(),
          editedAt: null,
          deletedAt: null,
          replyToMessageId: null,
          threadRootId: null,
          deletedBy: null,
          _count: { reactions: 0, attachments: 0 },
        },
        {
          publicId: 'msg_edited',
          senderId: 'u1',
          type: MessageType.TEXT,
          createdAt: new Date(),
          editedAt: new Date(),
          deletedAt: null,
          replyToMessageId: null,
          threadRootId: null,
          deletedBy: null,
          _count: { reactions: 0, attachments: 0 },
        },
        {
          publicId: 'msg_deleted',
          senderId: 'u1',
          type: MessageType.TEXT,
          createdAt: new Date(),
          editedAt: null,
          deletedAt: new Date(),
          replyToMessageId: null,
          threadRootId: null,
          deletedBy: 'u1',
          _count: { reactions: 0, attachments: 0 },
        },
      ]);

      const result = await controller.listConversationMessages(USER as never, PROJECT_ID, 'conv_abc');

      expect(result.map((m) => m.status)).toEqual(['sent', 'edited', 'deleted']);
    });

    it('filters by senderId when provided', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await controller.listConversationMessages(USER as never, PROJECT_ID, 'conv_abc', 'user_42');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ senderId: 'user_42' }) }),
      );
    });

    it('ignores an unparseable date filter rather than crashing', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await expect(
        controller.listConversationMessages(USER as never, PROJECT_ID, 'conv_abc', undefined, 'not-a-date'),
      ).resolves.toEqual([]);

      const call = prisma.message.findMany.mock.calls[0][0];
      expect(call.where.createdAt).toBeUndefined();
    });

    it('caps the limit at 200 regardless of what is requested', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await controller.listConversationMessages(
        USER as never,
        PROJECT_ID,
        'conv_abc',
        undefined,
        undefined,
        undefined,
        '10000',
      );

      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    });
  });
});
