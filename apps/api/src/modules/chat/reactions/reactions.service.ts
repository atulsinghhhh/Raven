import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../shared/database/prisma.service';
import { WebhookEventsService } from '../../webhooks/webhook-events.service';
import { ChatActor, resolveSubjectId } from '../auth/chat-actor.interface';
import { ChatError } from '../chat-error';
import { ChatErrorCode, ChatServerFrame } from '../chat.constants';
import { assertScope } from '../chat-permissions';
import { ChatMetricsService } from '../metrics/chat-metrics.service';
import { MessagesService } from '../messages/messages.service';
import { summarizeReactions } from '../messages/message.serializer';
import { ChatRateLimitService } from '../rate-limit/chat-rate-limit.service';
import { ChatEventsService } from '../realtime/chat-events.service';
import { ChatReactionSummary } from '../realtime/chat-event.interface';

// Emoji are user-visible strings, not codepoints we want to police, but
// an unbounded "emoji" field is just a second message body with no limit.
const MAX_EMOJI_LENGTH = 32;

export interface ReactionResult {
  messageId: string;
  roomId: string;
  userId: string;
  emoji: string;
  reactions: ChatReactionSummary[];
}

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly messages: MessagesService,
    private readonly events: ChatEventsService,
    private readonly rateLimit: ChatRateLimitService,
    private readonly metrics: ChatMetricsService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  /**
   * Adding the same reaction twice is a no-op, not a duplicate row;
   * enforced by the `(messageId, userId, emoji)` unique index and made
   * idempotent here so a double-tap on a flaky connection is harmless
   * (spec §23).
   */
  async add(actor: ChatActor, messagePublicId: string, emoji: string): Promise<ReactionResult> {
    const { message, conversation, scopes } = await this.messages.loadForActor(actor, messagePublicId);
    assertScope(scopes, 'chat:send', 'Reacting to a message');

    if (message.deletedAt) {
      throw new ChatError(ChatErrorCode.MESSAGE_DELETED, 'Cannot react to a deleted message');
    }

    const userId = resolveSubjectId(actor, null);
    if (!userId) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to react');
    }

    assertEmoji(emoji);
    await this.rateLimit.consume('reaction', actor.projectId, userId);

    const maxReactions = this.configService.get<number>('chat.maxReactionsPerMessage')!;
    const existingCount = await this.prisma.reaction.count({ where: { messageId: message.id } });
    if (existingCount >= maxReactions) {
      throw new ChatError(
        ChatErrorCode.MESSAGE_TOO_LARGE,
        `This message already has the maximum of ${maxReactions} reactions`,
      );
    }

    await this.prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId: message.id, userId, emoji } },
      create: {
        messageId: message.id,
        conversationId: conversation.id,
        projectId: actor.projectId,
        userId,
        emoji,
      },
      // Nothing to change: the row existing is the whole state.
      update: {},
    });

    const reactions = await this.summarize(message.id);
    const at = new Date().toISOString();

    await this.events.publish(actor.projectId, conversation.id, {
      type: ChatServerFrame.REACTION_ADDED,
      conversationId: conversation.id,
      roomId: conversation.publicId,
      messageId: message.publicId,
      userId,
      emoji,
      at,
    });
    void this.webhooks.emit(actor, 'reaction.added', {
      messageId: message.publicId,
      roomId: conversation.publicId,
      userId,
      emoji,
      at,
    });
    this.metrics.increment(actor.projectId, 'messages_fanned_out');

    return { messageId: message.publicId, roomId: conversation.publicId, userId, emoji, reactions };
  }

  /** Removing a reaction that isn't there succeeds: same end state, no error. */
  async remove(actor: ChatActor, messagePublicId: string, emoji: string): Promise<ReactionResult> {
    const { message, conversation, scopes } = await this.messages.loadForActor(actor, messagePublicId);
    assertScope(scopes, 'chat:send', 'Removing a reaction');

    const userId = resolveSubjectId(actor, null);
    if (!userId) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to remove a reaction');
    }
    assertEmoji(emoji);

    await this.prisma.reaction.deleteMany({ where: { messageId: message.id, userId, emoji } });

    const reactions = await this.summarize(message.id);
    const at = new Date().toISOString();

    await this.events.publish(actor.projectId, conversation.id, {
      type: ChatServerFrame.REACTION_REMOVED,
      conversationId: conversation.id,
      roomId: conversation.publicId,
      messageId: message.publicId,
      userId,
      emoji,
      at,
    });
    void this.webhooks.emit(actor, 'reaction.removed', {
      messageId: message.publicId,
      roomId: conversation.publicId,
      userId,
      emoji,
      at,
    });

    return { messageId: message.publicId, roomId: conversation.publicId, userId, emoji, reactions };
  }

  private async summarize(messageId: string): Promise<ChatReactionSummary[]> {
    const rows = await this.prisma.reaction.findMany({ where: { messageId } });
    return summarizeReactions(rows);
  }
}

function assertEmoji(emoji: string): void {
  if (typeof emoji !== 'string' || emoji.trim().length === 0) {
    throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'An emoji is required');
  }
  if (emoji.length > MAX_EMOJI_LENGTH) {
    throw new ChatError(
      ChatErrorCode.MESSAGE_TOO_LARGE,
      `Reaction is too long — the limit is ${MAX_EMOJI_LENGTH} characters`,
    );
  }
}
