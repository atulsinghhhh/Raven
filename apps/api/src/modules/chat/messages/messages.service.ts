import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttachmentStatus,
  Conversation,
  Message,
  MessageType,
  Prisma,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { generateId } from '../../../shared/utils/crypto.util';
import { RedisService } from '../../../shared/redis/redis.service';
import { WebhookEventsService } from '../../webhooks/webhook-events.service';
import { ChatActor, resolveSubjectId } from '../auth/chat-actor.interface';
import { ChatError } from '../chat-error';
import { ChatErrorCode, ChatServerFrame, RedisKeys } from '../chat.constants';
import { assertScope } from '../chat-permissions';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatMetricsService } from '../metrics/chat-metrics.service';
import { ChatRateLimitService } from '../rate-limit/chat-rate-limit.service';
import { ChatEventsService } from '../realtime/chat-events.service';
import { toJsonInput } from '../json.util';
import { ChatMessageView } from '../realtime/chat-event.interface';
import { cursorFilter, decodeCursor, encodeCursor } from './cursor.util';
import { ListMessagesDto } from './dto/list-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import {
  ChatLimits,
  assertMessageBodyPresent,
  assertMessageTypeAllowed,
  assertMetadataWithinLimits,
  assertTextWithinLimits,
} from './message-limits.util';
import { MessageWithRelations, toMessageView } from './message.serializer';

const MESSAGE_INCLUDE = { reactions: true, attachments: true } as const;
/** Fast-path duplicate cache. It only has to cover a reconnect-and-retry, not eternity. */
const IDEMPOTENCY_CACHE_TTL_SECONDS = 600;

export interface SendMessageResult {
  message: ChatMessageView;
  /** True when an idempotency key matched an existing row, so nothing new got written. */
  deduplicated: boolean;
  /** Milliseconds from "request accepted" to "durably in Postgres". */
  persistLatencyMs: number;
}

export interface MessagePage {
  data: ChatMessageView[];
  nextCursor: string | null;
  /** Cursor for walking forward, toward newer. Used when catching up after a reconnect. */
  previousCursor: string | null;
  hasMore: boolean;
}

/**
 * The durable half of Livqeno Chat.
 *
 * Everything here writes to Postgres first and publishes to Redis second. A
 * message is never reported as stored before it genuinely is (spec §15,
 * §18), and the WebSocket is never the source of truth (spec §19).
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly conversations: ConversationsService,
    private readonly events: ChatEventsService,
    private readonly rateLimit: ChatRateLimitService,
    private readonly metrics: ChatMetricsService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  private get limits(): ChatLimits {
    return {
      maxTextLength: this.configService.get<number>('chat.maxTextLength')!,
      maxMetadataBytes: this.configService.get<number>('chat.maxMetadataBytes')!,
      maxFrameBytes: this.configService.get<number>('chat.maxFrameBytes')!,
      maxReactionsPerMessage: this.configService.get<number>('chat.maxReactionsPerMessage')!,
      maxHistoryPageSize: this.configService.get<number>('chat.maxHistoryPageSize')!,
    };
  }

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------

  /**
   * Validate → rate limit → persist → publish. That ordering *is* the
   * contract. The message that comes back carries the canonical
   * server-generated id and timestamp, and by the time you have it, the row
   * exists.
   *
   * `originConnectionId` only tags the fan-out envelope. The sender still
   * gets its own message back over the socket, so everyone renders the same
   * server-ordered row.
   */
  async send(
    actor: ChatActor,
    roomReference: string,
    dto: SendMessageDto,
    originConnectionId?: string,
  ): Promise<SendMessageResult> {
    const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
    this.conversations.assertWritable(conversation);
    assertScope(scopes, 'chat:send', 'Sending a message');

    // The sender comes from the authenticated actor. A client actor's
    // `senderId` in the body gets thrown away outright (spec §39).
    const senderId = resolveSubjectId(actor, dto.senderId);
    if (!senderId) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'senderId is required when sending with an API key');
    }

    const type = (dto.type?.toUpperCase() as MessageType) ?? MessageType.TEXT;
    assertMessageTypeAllowed(type, actor.kind);
    assertMessageBodyPresent(type, dto.text, dto.attachmentId);
    assertTextWithinLimits(dto.text, this.limits);
    assertMetadataWithinLimits(dto.metadata, this.limits);

    await this.rateLimit.consume('send', actor.projectId, senderId);

    // Cheap duplicate check before we touch Postgres. The unique constraint
    // below is what actually guarantees correctness; this only saves a round
    // trip on the common retry path.
    if (dto.clientMessageId) {
      const cached = await this.readIdempotencyCache(
        actor.projectId,
        conversation.id,
        senderId,
        dto.clientMessageId,
      );
      if (cached) {
        const existing = await this.findByPublicId(cached, conversation);
        if (existing) {
          return { message: existing, deduplicated: true, persistLatencyMs: 0 };
        }
      }
    }

    const replyTo = dto.replyTo ? await this.loadReplyTarget(conversation.id, dto.replyTo) : null;
    const attachment = dto.attachmentId
      ? await this.loadAttachmentForMessage(conversation.id, dto.attachmentId, senderId)
      : null;

    const startedAt = Date.now();
    let created: MessageWithRelations;
    let deduplicated = false;

    try {
      created = await this.prisma.message.create({
        data: {
          publicId: generateId('msg'),
          projectId: actor.projectId,
          conversationId: conversation.id,
          roomId: conversation.roomId,
          senderId,
          type,
          content: dto.text ?? null,
          replyToMessageId: replyTo?.id ?? null,
          // A reply to a reply stays in the same thread instead of starting
          // a nested one. That's what keeps a thread to a single indexed
          // range scan (spec §26).
          threadRootId: replyTo ? (replyTo.threadRootId ?? replyTo.id) : null,
          clientMessageId: dto.clientMessageId ?? null,
          metadata: toJsonInput(dto.metadata),
          ...(attachment ? { attachments: { connect: { id: attachment.id } } } : {}),
        },
        include: MESSAGE_INCLUDE,
      });
    } catch (err) {
      // P2002 on the idempotency index means a concurrent, or retried, send
      // won the race. Return that message rather than fail: the caller's
      // intent was satisfied exactly once (spec §16).
      if (isUniqueViolation(err) && dto.clientMessageId) {
        const existing = await this.prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            senderId,
            clientMessageId: dto.clientMessageId,
          },
          include: MESSAGE_INCLUDE,
        });
        if (existing) {
          created = existing;
          deduplicated = true;
        } else {
          throw err;
        }
      } else {
        this.metrics.increment(actor.projectId, 'messages_failed');
        throw err;
      }
    }

    const persistLatencyMs = Date.now() - startedAt;

    if (deduplicated) {
      const view = await this.buildView(created, conversation);
      return { message: view, deduplicated: true, persistLatencyMs };
    }

    if (attachment) {
      await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: { messageId: created.id },
      });
    }
    if (dto.clientMessageId) {
      await this.writeIdempotencyCache(
        actor.projectId,
        conversation.id,
        senderId,
        dto.clientMessageId,
        created.publicId,
      );
    }

    const view = await this.buildView(created, conversation, replyTo);

    // Durable first, real-time second. Fan-out and webhooks are both
    // best-effort from here on. The message already exists, and neither is
    // allowed to fail the send.
    await this.events.publish(actor.projectId, conversation.id, {
      type: ChatServerFrame.MESSAGE,
      conversationId: conversation.id,
      message: view,
    }, originConnectionId);

    this.metrics.increment(actor.projectId, 'messages_sent');
    this.metrics.recordLatency(actor.projectId, 'persist', persistLatencyMs);
    if (dto.clientSentAt) {
      // A wall-clock difference between two machines, so it's only ever as
      // good as the client's clock. Recorded anyway, because it's the number
      // a developer actually feels, and labelled honestly in the docs.
      this.metrics.recordLatency(actor.projectId, 'end_to_end', Date.now() - dto.clientSentAt);
    }

    void this.webhooks.emit(actor, 'message.created', { message: view });

    return { message: view, deduplicated: false, persistLatencyMs };
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Newest-first history, keyset pagination (spec §17).
   *
   * `before` walks back through history. `after` walks forward, which is
   * what a client uses to catch up on whatever it missed while disconnected
   * (spec §19).
   */
  async list(actor: ChatActor, roomReference: string, dto: ListMessagesDto): Promise<MessagePage> {
    const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
    assertScope(scopes, 'chat:read', 'Reading messages');

    const limit = Math.min(dto.limit ?? 50, this.limits.maxHistoryPageSize);
    const ascending = Boolean(dto.after);

    const where: Prisma.MessageWhereInput = {
      conversationId: conversation.id,
      ...(dto.threadRootId ? { threadRootId: await this.resolveInternalId(conversation.id, dto.threadRootId) } : {}),
      ...(dto.senderId ? { senderId: dto.senderId } : {}),
      ...(dto.includeDeleted ? {} : { deletedAt: null }),
    };

    if (dto.before) {
      Object.assign(where, cursorFilter(decodeCursor(dto.before), 'before'));
    } else if (dto.after) {
      Object.assign(where, cursorFilter(decodeCursor(dto.after), 'after'));
    }

    // limit + 1 tells us whether another page exists, without a second
    // COUNT query over the same range.
    const rows = await this.prisma.message.findMany({
      where,
      include: MESSAGE_INCLUDE,
      // Tiebreak on publicId, matching what the cursor compares. Sort by
      // one column and paginate on another and you quietly drop rows that
      // share a timestamp.
      orderBy: [{ createdAt: ascending ? 'asc' : 'desc' }, { publicId: ascending ? 'asc' : 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const views = await this.buildViews(page, conversation);

    // Always hand back newest-first, whichever direction we scanned, so no
    // client ever has to care which cursor it used.
    const ordered = ascending ? [...views].reverse() : views;
    const orderedRows = ascending ? [...page].reverse() : page;
    const oldest = orderedRows[orderedRows.length - 1];
    const newest = orderedRows[0];

    return {
      data: ordered,
      nextCursor: hasMore && oldest ? encodeCursor({ createdAt: oldest.createdAt, publicId: oldest.publicId }) : null,
      previousCursor: newest ? encodeCursor({ createdAt: newest.createdAt, publicId: newest.publicId }) : null,
      hasMore,
    };
  }

  /** Every message in a thread, oldest-first: the root plus its replies (spec §26). */
  async listThread(actor: ChatActor, messagePublicId: string, limit = 100): Promise<ChatMessageView[]> {
    const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);
    assertScope(scopes, 'chat:read', 'Reading a thread');

    const rootId = message.threadRootId ?? message.id;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        deletedAt: null,
        OR: [{ id: rootId }, { threadRootId: rootId }],
      },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: Math.min(limit, this.limits.maxHistoryPageSize),
    });

    return this.buildViews(rows, conversation);
  }

  async get(actor: ChatActor, messagePublicId: string): Promise<ChatMessageView> {
    const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);
    assertScope(scopes, 'chat:read', 'Reading a message');
    return this.buildView(message, conversation);
  }

  // -------------------------------------------------------------------------
  // Update / delete
  // -------------------------------------------------------------------------

  /**
   * Every edit is recorded: `editedAt` gets set and `edited: true` comes
   * back on the message. History is never quietly rewritten (spec §24).
   *
   * Only the author may edit. Moderation can delete; it can't put words in
   * somebody's mouth.
   */
  async update(actor: ChatActor, messagePublicId: string, dto: UpdateMessageDto): Promise<ChatMessageView> {
    const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);
    this.conversations.assertWritable(conversation);

    if (message.deletedAt) {
      throw new ChatError(ChatErrorCode.MESSAGE_DELETED, 'A deleted message cannot be edited');
    }

    const editorId = resolveSubjectId(actor, null);
    const isAuthor = editorId !== null && editorId === message.senderId;
    if (!isAuthor && actor.kind !== 'server') {
      throw new ChatError(ChatErrorCode.PERMISSION_DENIED, 'Only the author can edit a message');
    }
    assertScope(scopes, 'chat:send', 'Editing a message');

    assertTextWithinLimits(dto.text, this.limits);
    assertMetadataWithinLimits(dto.metadata, this.limits);
    if (dto.text !== undefined) {
      assertMessageBodyPresent(message.type, dto.text, null);
    }

    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        ...(dto.text !== undefined ? { content: dto.text } : {}),
        ...(dto.metadata !== undefined ? { metadata: toJsonInput(dto.metadata) } : {}),
        editedAt: new Date(),
      },
      include: MESSAGE_INCLUDE,
    });

    const view = await this.buildView(updated, conversation);
    await this.events.publish(actor.projectId, conversation.id, {
      type: ChatServerFrame.MESSAGE_UPDATED,
      conversationId: conversation.id,
      message: view,
    });
    void this.webhooks.emit(actor, 'message.updated', { message: view });

    return view;
  }

  /**
   * Soft delete (spec §25).
   *
   * The row survives with `deletedAt` set, so the deletion event can name
   * it, clients can render a placeholder in the right position, and
   * moderation keeps an audit trail. Hard removal is the retention
   * sweeper's job, not this one's.
   */
  async delete(actor: ChatActor, messagePublicId: string): Promise<ChatMessageView> {
    const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);

    if (message.deletedAt) {
      // Idempotent. Deleting twice isn't an error; it's the same outcome.
      return this.buildView(message, conversation);
    }

    const deleterId = resolveSubjectId(actor, null);
    const isAuthor = deleterId !== null && deleterId === message.senderId;
    if (!isAuthor) {
      // Deleting somebody else's message is moderation, and needs the
      // scope.
      assertScope(scopes, 'chat:moderate', 'Deleting another member\'s message');
    } else {
      assertScope(scopes, 'chat:send', 'Deleting your message');
    }

    const deletedAt = new Date();
    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: { deletedAt, deletedBy: deleterId },
      include: MESSAGE_INCLUDE,
    });

    await this.events.publish(actor.projectId, conversation.id, {
      type: ChatServerFrame.MESSAGE_DELETED,
      conversationId: conversation.id,
      roomId: conversation.publicId,
      messageId: updated.publicId,
      deletedAt: deletedAt.toISOString(),
      deletedBy: deleterId,
    });
    void this.webhooks.emit(actor, 'message.deleted', {
      messageId: updated.publicId,
      roomId: conversation.publicId,
      deletedAt: deletedAt.toISOString(),
      deletedBy: deleterId,
    });

    return this.buildView(updated, conversation);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Resolves a `msg_...` id and checks the caller is allowed near its conversation. */
  async loadForActor(actor: ChatActor, messagePublicId: string) {
    const message = await this.prisma.message.findUnique({
      where: { publicId: messagePublicId },
      include: MESSAGE_INCLUDE,
    });
    // A wrong-project message gets the same "not found" as a missing one.
    // Nobody should be able to probe for valid ids across tenants.
    if (!message || message.projectId !== actor.projectId) {
      throw new ChatError(ChatErrorCode.MESSAGE_NOT_FOUND, `Message "${messagePublicId}" not found`);
    }

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: message.conversationId },
    });
    const authorized = await this.conversations.authorize(actor, conversation.publicId);

    return { message, conversation, scopes: authorized.scopes };
  }

  private async buildView(
    message: MessageWithRelations,
    conversation: Conversation,
    replyTarget?: Message | null,
  ): Promise<ChatMessageView> {
    const [replyToPublicId, threadRootPublicId] = await Promise.all([
      replyTarget
        ? Promise.resolve(replyTarget.publicId)
        : this.publicIdFor(message.replyToMessageId),
      this.publicIdFor(message.threadRootId),
    ]);
    return toMessageView(message, conversation, { replyToPublicId, threadRootPublicId });
  }

  /**
   * Batch variant. Resolves every reply and thread reference in the page
   * with one extra query, not one per message. That's the difference
   * between 1 query and 51 on a 50-message page.
   */
  private async buildViews(
    messages: MessageWithRelations[],
    conversation: Conversation,
  ): Promise<ChatMessageView[]> {
    const referenced = new Set<string>();
    for (const message of messages) {
      if (message.replyToMessageId) referenced.add(message.replyToMessageId);
      if (message.threadRootId) referenced.add(message.threadRootId);
    }

    const publicIds = new Map<string, string>();
    if (referenced.size > 0) {
      const rows = await this.prisma.message.findMany({
        where: { id: { in: Array.from(referenced) } },
        select: { id: true, publicId: true },
      });
      for (const row of rows) publicIds.set(row.id, row.publicId);
    }

    return messages.map((message) =>
      toMessageView(message, conversation, {
        replyToPublicId: message.replyToMessageId ? publicIds.get(message.replyToMessageId) ?? null : null,
        threadRootPublicId: message.threadRootId ? publicIds.get(message.threadRootId) ?? null : null,
      }),
    );
  }

  private async publicIdFor(internalId: string | null): Promise<string | null> {
    if (!internalId) return null;
    const row = await this.prisma.message.findUnique({
      where: { id: internalId },
      select: { publicId: true },
    });
    return row?.publicId ?? null;
  }

  private async resolveInternalId(conversationId: string, messagePublicId: string): Promise<string> {
    const row = await this.prisma.message.findUnique({
      where: { publicId: messagePublicId },
      select: { id: true, conversationId: true },
    });
    if (!row || row.conversationId !== conversationId) {
      throw new ChatError(ChatErrorCode.MESSAGE_NOT_FOUND, `Message "${messagePublicId}" not found`);
    }
    return row.id;
  }

  private async findByPublicId(publicId: string, conversation: Conversation): Promise<ChatMessageView | null> {
    const row = await this.prisma.message.findUnique({
      where: { publicId },
      include: MESSAGE_INCLUDE,
    });
    if (!row || row.conversationId !== conversation.id) {
      return null;
    }
    return this.buildView(row, conversation);
  }

  private async loadReplyTarget(conversationId: string, replyToPublicId: string): Promise<Message> {
    const target = await this.prisma.message.findUnique({ where: { publicId: replyToPublicId } });
    // A cross-conversation reply would let a message reference a thread the
    // reader can't see. Refuse it rather than produce a dangling link.
    if (!target || target.conversationId !== conversationId) {
      throw new ChatError(
        ChatErrorCode.MESSAGE_NOT_FOUND,
        `Cannot reply to "${replyToPublicId}" — it is not in this conversation`,
      );
    }
    if (target.deletedAt) {
      throw new ChatError(ChatErrorCode.MESSAGE_DELETED, 'Cannot reply to a deleted message');
    }
    return target;
  }

  private async loadAttachmentForMessage(conversationId: string, attachmentPublicId: string, uploaderId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { publicId: attachmentPublicId } });
    if (!attachment || attachment.conversationId !== conversationId) {
      throw new ChatError(ChatErrorCode.ATTACHMENT_NOT_FOUND, `Attachment "${attachmentPublicId}" not found`);
    }
    if (attachment.uploaderId !== uploaderId) {
      throw new ChatError(ChatErrorCode.PERMISSION_DENIED, 'That attachment was uploaded by someone else');
    }
    if (attachment.messageId) {
      throw new ChatError(ChatErrorCode.INVALID_MESSAGE, 'That attachment is already attached to a message');
    }
    if (attachment.status !== AttachmentStatus.UPLOADED) {
      throw new ChatError(
        ChatErrorCode.INVALID_MESSAGE,
        'Confirm the upload (POST /v1/chat/attachments/:id/complete) before attaching it to a message',
      );
    }
    return attachment;
  }

  private async readIdempotencyCache(
    projectId: string,
    conversationId: string,
    senderId: string,
    clientMessageId: string,
  ): Promise<string | null> {
    try {
      return await this.redisService.client.get(
        RedisKeys.idempotency(projectId, conversationId, senderId, clientMessageId),
      );
    } catch (err) {
      // Falling through to the DB constraint is still correct. Just
      // slower.
      this.logger.warn(`idempotency cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async writeIdempotencyCache(
    projectId: string,
    conversationId: string,
    senderId: string,
    clientMessageId: string,
    messagePublicId: string,
  ): Promise<void> {
    try {
      await this.redisService.client.set(
        RedisKeys.idempotency(projectId, conversationId, senderId, clientMessageId),
        messagePublicId,
        'EX',
        IDEMPOTENCY_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`idempotency cache write failed: ${(err as Error).message}`);
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}
