import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ChatActor, resolveSubjectId } from '../auth/chat-actor.interface';
import { ChatError } from '../chat-error';
import { ChatErrorCode, ChatServerFrame } from '../chat.constants';
import { assertScope } from '../chat-permissions';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { ChatEventsService } from '../realtime/chat-events.service';

export interface ReadStateView {
  roomId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: string;
  unreadCount: number;
}

/**
 * Read receipts as a *position*, not a log (spec §22).
 *
 * One row per (conversation, user), holding the furthest-read message. So
 * marking 500 messages read is a single UPDATE, and an unread count is one
 * indexed COUNT, not a set difference over a receipts table.
 *
 * Raven's delivery vocabulary, stated plainly:
 *   - **accepted**: the send ack, returned only once the row is durably in
 *     Postgres. This is the one Raven actually guarantees.
 *   - **delivered**: a recipient's live socket received the fan-out.
 *     Reported per broadcast as a count and never stored, because a socket
 *     receiving bytes is no proof a person saw them.
 *   - **read**: this table. Explicit, durable, client-driven.
 *
 * See docs/chat/read-receipts.md.
 */
@Injectable()
export class ReadStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly events: ChatEventsService,
  ) {}

  async markRead(actor: ChatActor, messagePublicId: string): Promise<ReadStateView> {
    const { message, conversation, scopes } = await this.messages.loadForActor(actor, messagePublicId);
    assertScope(scopes, 'chat:read', 'Marking a message read');

    const userId = resolveSubjectId(actor, null);
    if (!userId) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to mark messages read');
    }

    const existing = await this.prisma.readState.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
    });

    // Never move the marker backwards. Two tabs racing, one scrolled to the
    // bottom and one at the top, mustn't un-read what the user has already
    // seen.
    if (existing && existing.lastReadAt >= message.createdAt) {
      return this.view(conversation.publicId, userId, existing.lastReadMessageId, existing.lastReadAt, conversation.id);
    }

    const updated = await this.prisma.readState.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      create: {
        conversationId: conversation.id,
        projectId: actor.projectId,
        userId,
        lastReadMessageId: message.id,
        lastReadAt: message.createdAt,
      },
      update: { lastReadMessageId: message.id, lastReadAt: message.createdAt },
    });

    await this.events.publish(actor.projectId, conversation.id, {
      type: ChatServerFrame.READ,
      conversationId: conversation.id,
      roomId: conversation.publicId,
      userId,
      messageId: message.publicId,
      at: new Date().toISOString(),
    });

    return this.view(conversation.publicId, userId, updated.lastReadMessageId, updated.lastReadAt, conversation.id);
  }

  /** This user's own read position and unread count for one conversation. */
  async get(actor: ChatActor, roomReference: string): Promise<ReadStateView> {
    const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
    assertScope(scopes, 'chat:read', 'Reading read state');

    const userId = resolveSubjectId(actor, null);
    if (!userId) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to read read state');
    }

    const state = await this.prisma.readState.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
    });

    return this.view(
      conversation.publicId,
      userId,
      state?.lastReadMessageId ?? null,
      state?.lastReadAt ?? new Date(0),
      conversation.id,
    );
  }

  /**
   * Everyone's read position in a conversation. This is what a "seen by" row
   * in the UI is built from.
   *
   * Capped, because a 10,000-member channel shouldn't return 10,000 rows to
   * render three avatars.
   */
  async listForConversation(actor: ChatActor, roomReference: string, limit = 200): Promise<ReadStateView[]> {
    const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
    assertScope(scopes, 'chat:read', 'Reading read receipts');

    const states = await this.prisma.readState.findMany({
      where: { conversationId: conversation.id },
      include: { lastReadMessage: { select: { publicId: true } } },
      orderBy: { lastReadAt: 'desc' },
      take: Math.min(limit, 500),
    });

    return states.map((state) => ({
      roomId: conversation.publicId,
      userId: state.userId,
      lastReadMessageId: state.lastReadMessage?.publicId ?? null,
      lastReadAt: state.lastReadAt.toISOString(),
      // Skipped on purpose. Computing per-user unread counts here would be
      // one COUNT per member. A caller can ask for their own via get().
      unreadCount: 0,
    }));
  }

  private async view(
    roomPublicId: string,
    userId: string,
    lastReadMessageInternalId: string | null,
    lastReadAt: Date,
    conversationId?: string,
  ): Promise<ReadStateView> {
    const [publicId, unreadCount] = await Promise.all([
      lastReadMessageInternalId
        ? this.prisma.message
            .findUnique({ where: { id: lastReadMessageInternalId }, select: { publicId: true } })
            .then((row) => row?.publicId ?? null)
        : Promise.resolve(null),
      conversationId
        ? this.prisma.message.count({
            where: {
              conversationId,
              deletedAt: null,
              createdAt: { gt: lastReadAt },
              // Your own messages are never unread to you.
              senderId: { not: userId },
            },
          })
        : Promise.resolve(0),
    ]);

    return {
      roomId: roomPublicId,
      userId,
      lastReadMessageId: publicId,
      lastReadAt: lastReadAt.toISOString(),
      unreadCount,
    };
  }
}
