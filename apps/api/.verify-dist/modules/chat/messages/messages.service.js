"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MessagesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagesService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("../../../generated/prisma/client");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const crypto_util_1 = require("../../../shared/utils/crypto.util");
const redis_service_1 = require("../../../shared/redis/redis.service");
const webhook_events_service_1 = require("../../webhooks/webhook-events.service");
const chat_actor_interface_1 = require("../auth/chat-actor.interface");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const chat_permissions_1 = require("../chat-permissions");
const conversations_service_1 = require("../conversations/conversations.service");
const chat_metrics_service_1 = require("../metrics/chat-metrics.service");
const chat_rate_limit_service_1 = require("../rate-limit/chat-rate-limit.service");
const chat_events_service_1 = require("../realtime/chat-events.service");
const json_util_1 = require("../json.util");
const cursor_util_1 = require("./cursor.util");
const message_limits_util_1 = require("./message-limits.util");
const message_serializer_1 = require("./message.serializer");
const MESSAGE_INCLUDE = { reactions: true, attachments: true };
const IDEMPOTENCY_CACHE_TTL_SECONDS = 600;
let MessagesService = MessagesService_1 = class MessagesService {
    constructor(prisma, redisService, configService, conversations, events, rateLimit, metrics, webhooks) {
        this.prisma = prisma;
        this.redisService = redisService;
        this.configService = configService;
        this.conversations = conversations;
        this.events = events;
        this.rateLimit = rateLimit;
        this.metrics = metrics;
        this.webhooks = webhooks;
        this.logger = new common_1.Logger(MessagesService_1.name);
    }
    get limits() {
        return {
            maxTextLength: this.configService.get('chat.maxTextLength'),
            maxMetadataBytes: this.configService.get('chat.maxMetadataBytes'),
            maxFrameBytes: this.configService.get('chat.maxFrameBytes'),
            maxReactionsPerMessage: this.configService.get('chat.maxReactionsPerMessage'),
            maxHistoryPageSize: this.configService.get('chat.maxHistoryPageSize'),
        };
    }
    async send(actor, roomReference, dto, originConnectionId) {
        const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
        this.conversations.assertWritable(conversation);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:send', 'Sending a message');
        const senderId = (0, chat_actor_interface_1.resolveSubjectId)(actor, dto.senderId);
        if (!senderId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'senderId is required when sending with an API key');
        }
        const type = dto.type?.toUpperCase() ?? client_1.MessageType.TEXT;
        (0, message_limits_util_1.assertMessageTypeAllowed)(type, actor.kind);
        (0, message_limits_util_1.assertMessageBodyPresent)(type, dto.text, dto.attachmentId);
        (0, message_limits_util_1.assertTextWithinLimits)(dto.text, this.limits);
        (0, message_limits_util_1.assertMetadataWithinLimits)(dto.metadata, this.limits);
        await this.rateLimit.consume('send', actor.projectId, senderId);
        if (dto.clientMessageId) {
            const cached = await this.readIdempotencyCache(actor.projectId, conversation.id, senderId, dto.clientMessageId);
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
        let created;
        let deduplicated = false;
        try {
            created = await this.prisma.message.create({
                data: {
                    publicId: (0, crypto_util_1.generateId)('msg'),
                    projectId: actor.projectId,
                    conversationId: conversation.id,
                    roomId: conversation.roomId,
                    senderId,
                    type,
                    content: dto.text ?? null,
                    replyToMessageId: replyTo?.id ?? null,
                    threadRootId: replyTo ? (replyTo.threadRootId ?? replyTo.id) : null,
                    clientMessageId: dto.clientMessageId ?? null,
                    metadata: (0, json_util_1.toJsonInput)(dto.metadata),
                    ...(attachment ? { attachments: { connect: { id: attachment.id } } } : {}),
                },
                include: MESSAGE_INCLUDE,
            });
        }
        catch (err) {
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
                }
                else {
                    throw err;
                }
            }
            else {
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
            await this.writeIdempotencyCache(actor.projectId, conversation.id, senderId, dto.clientMessageId, created.publicId);
        }
        const view = await this.buildView(created, conversation, replyTo);
        await this.events.publish(actor.projectId, conversation.id, {
            type: chat_constants_1.ChatServerFrame.MESSAGE,
            conversationId: conversation.id,
            message: view,
        }, originConnectionId);
        this.metrics.increment(actor.projectId, 'messages_sent');
        this.metrics.recordLatency(actor.projectId, 'persist', persistLatencyMs);
        if (dto.clientSentAt) {
            this.metrics.recordLatency(actor.projectId, 'end_to_end', Date.now() - dto.clientSentAt);
        }
        void this.webhooks.emit(actor.projectId, 'message.created', { message: view });
        return { message: view, deduplicated: false, persistLatencyMs };
    }
    async list(actor, roomReference, dto) {
        const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:read', 'Reading messages');
        const limit = Math.min(dto.limit ?? 50, this.limits.maxHistoryPageSize);
        const ascending = Boolean(dto.after);
        const where = {
            conversationId: conversation.id,
            ...(dto.threadRootId ? { threadRootId: await this.resolveInternalId(conversation.id, dto.threadRootId) } : {}),
            ...(dto.senderId ? { senderId: dto.senderId } : {}),
            ...(dto.includeDeleted ? {} : { deletedAt: null }),
        };
        if (dto.before) {
            Object.assign(where, (0, cursor_util_1.cursorFilter)((0, cursor_util_1.decodeCursor)(dto.before), 'before'));
        }
        else if (dto.after) {
            Object.assign(where, (0, cursor_util_1.cursorFilter)((0, cursor_util_1.decodeCursor)(dto.after), 'after'));
        }
        const rows = await this.prisma.message.findMany({
            where,
            include: MESSAGE_INCLUDE,
            orderBy: [{ createdAt: ascending ? 'asc' : 'desc' }, { publicId: ascending ? 'asc' : 'desc' }],
            take: limit + 1,
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const views = await this.buildViews(page, conversation);
        const ordered = ascending ? [...views].reverse() : views;
        const orderedRows = ascending ? [...page].reverse() : page;
        const oldest = orderedRows[orderedRows.length - 1];
        const newest = orderedRows[0];
        return {
            data: ordered,
            nextCursor: hasMore && oldest ? (0, cursor_util_1.encodeCursor)({ createdAt: oldest.createdAt, publicId: oldest.publicId }) : null,
            previousCursor: newest ? (0, cursor_util_1.encodeCursor)({ createdAt: newest.createdAt, publicId: newest.publicId }) : null,
            hasMore,
        };
    }
    async listThread(actor, messagePublicId, limit = 100) {
        const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:read', 'Reading a thread');
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
    async get(actor, messagePublicId) {
        const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:read', 'Reading a message');
        return this.buildView(message, conversation);
    }
    async update(actor, messagePublicId, dto) {
        const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);
        this.conversations.assertWritable(conversation);
        if (message.deletedAt) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_DELETED, 'A deleted message cannot be edited');
        }
        const editorId = (0, chat_actor_interface_1.resolveSubjectId)(actor, null);
        const isAuthor = editorId !== null && editorId === message.senderId;
        if (!isAuthor && actor.kind !== 'server') {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.PERMISSION_DENIED, 'Only the author can edit a message');
        }
        (0, chat_permissions_1.assertScope)(scopes, 'chat:send', 'Editing a message');
        (0, message_limits_util_1.assertTextWithinLimits)(dto.text, this.limits);
        (0, message_limits_util_1.assertMetadataWithinLimits)(dto.metadata, this.limits);
        if (dto.text !== undefined) {
            (0, message_limits_util_1.assertMessageBodyPresent)(message.type, dto.text, null);
        }
        const updated = await this.prisma.message.update({
            where: { id: message.id },
            data: {
                ...(dto.text !== undefined ? { content: dto.text } : {}),
                ...(dto.metadata !== undefined ? { metadata: (0, json_util_1.toJsonInput)(dto.metadata) } : {}),
                editedAt: new Date(),
            },
            include: MESSAGE_INCLUDE,
        });
        const view = await this.buildView(updated, conversation);
        await this.events.publish(actor.projectId, conversation.id, {
            type: chat_constants_1.ChatServerFrame.MESSAGE_UPDATED,
            conversationId: conversation.id,
            message: view,
        });
        void this.webhooks.emit(actor.projectId, 'message.updated', { message: view });
        return view;
    }
    async delete(actor, messagePublicId) {
        const { message, conversation, scopes } = await this.loadForActor(actor, messagePublicId);
        if (message.deletedAt) {
            return this.buildView(message, conversation);
        }
        const deleterId = (0, chat_actor_interface_1.resolveSubjectId)(actor, null);
        const isAuthor = deleterId !== null && deleterId === message.senderId;
        if (!isAuthor) {
            (0, chat_permissions_1.assertScope)(scopes, 'chat:moderate', 'Deleting another member\'s message');
        }
        else {
            (0, chat_permissions_1.assertScope)(scopes, 'chat:send', 'Deleting your message');
        }
        const deletedAt = new Date();
        const updated = await this.prisma.message.update({
            where: { id: message.id },
            data: { deletedAt, deletedBy: deleterId },
            include: MESSAGE_INCLUDE,
        });
        await this.events.publish(actor.projectId, conversation.id, {
            type: chat_constants_1.ChatServerFrame.MESSAGE_DELETED,
            conversationId: conversation.id,
            roomId: conversation.publicId,
            messageId: updated.publicId,
            deletedAt: deletedAt.toISOString(),
            deletedBy: deleterId,
        });
        void this.webhooks.emit(actor.projectId, 'message.deleted', {
            messageId: updated.publicId,
            roomId: conversation.publicId,
            deletedAt: deletedAt.toISOString(),
            deletedBy: deleterId,
        });
        return this.buildView(updated, conversation);
    }
    async loadForActor(actor, messagePublicId) {
        const message = await this.prisma.message.findUnique({
            where: { publicId: messagePublicId },
            include: MESSAGE_INCLUDE,
        });
        if (!message || message.projectId !== actor.projectId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_NOT_FOUND, `Message "${messagePublicId}" not found`);
        }
        const conversation = await this.prisma.conversation.findUniqueOrThrow({
            where: { id: message.conversationId },
        });
        const authorized = await this.conversations.authorize(actor, conversation.publicId);
        return { message, conversation, scopes: authorized.scopes };
    }
    async buildView(message, conversation, replyTarget) {
        const [replyToPublicId, threadRootPublicId] = await Promise.all([
            replyTarget
                ? Promise.resolve(replyTarget.publicId)
                : this.publicIdFor(message.replyToMessageId),
            this.publicIdFor(message.threadRootId),
        ]);
        return (0, message_serializer_1.toMessageView)(message, conversation, { replyToPublicId, threadRootPublicId });
    }
    async buildViews(messages, conversation) {
        const referenced = new Set();
        for (const message of messages) {
            if (message.replyToMessageId)
                referenced.add(message.replyToMessageId);
            if (message.threadRootId)
                referenced.add(message.threadRootId);
        }
        const publicIds = new Map();
        if (referenced.size > 0) {
            const rows = await this.prisma.message.findMany({
                where: { id: { in: Array.from(referenced) } },
                select: { id: true, publicId: true },
            });
            for (const row of rows)
                publicIds.set(row.id, row.publicId);
        }
        return messages.map((message) => (0, message_serializer_1.toMessageView)(message, conversation, {
            replyToPublicId: message.replyToMessageId ? publicIds.get(message.replyToMessageId) ?? null : null,
            threadRootPublicId: message.threadRootId ? publicIds.get(message.threadRootId) ?? null : null,
        }));
    }
    async publicIdFor(internalId) {
        if (!internalId)
            return null;
        const row = await this.prisma.message.findUnique({
            where: { id: internalId },
            select: { publicId: true },
        });
        return row?.publicId ?? null;
    }
    async resolveInternalId(conversationId, messagePublicId) {
        const row = await this.prisma.message.findUnique({
            where: { publicId: messagePublicId },
            select: { id: true, conversationId: true },
        });
        if (!row || row.conversationId !== conversationId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_NOT_FOUND, `Message "${messagePublicId}" not found`);
        }
        return row.id;
    }
    async findByPublicId(publicId, conversation) {
        const row = await this.prisma.message.findUnique({
            where: { publicId },
            include: MESSAGE_INCLUDE,
        });
        if (!row || row.conversationId !== conversation.id) {
            return null;
        }
        return this.buildView(row, conversation);
    }
    async loadReplyTarget(conversationId, replyToPublicId) {
        const target = await this.prisma.message.findUnique({ where: { publicId: replyToPublicId } });
        if (!target || target.conversationId !== conversationId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_NOT_FOUND, `Cannot reply to "${replyToPublicId}" — it is not in this conversation`);
        }
        if (target.deletedAt) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_DELETED, 'Cannot reply to a deleted message');
        }
        return target;
    }
    async loadAttachmentForMessage(conversationId, attachmentPublicId, uploaderId) {
        const attachment = await this.prisma.attachment.findUnique({ where: { publicId: attachmentPublicId } });
        if (!attachment || attachment.conversationId !== conversationId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ATTACHMENT_NOT_FOUND, `Attachment "${attachmentPublicId}" not found`);
        }
        if (attachment.uploaderId !== uploaderId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.PERMISSION_DENIED, 'That attachment was uploaded by someone else');
        }
        if (attachment.messageId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'That attachment is already attached to a message');
        }
        if (attachment.status !== client_1.AttachmentStatus.UPLOADED) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'Confirm the upload (POST /v1/chat/attachments/:id/complete) before attaching it to a message');
        }
        return attachment;
    }
    async readIdempotencyCache(projectId, conversationId, senderId, clientMessageId) {
        try {
            return await this.redisService.client.get(chat_constants_1.RedisKeys.idempotency(projectId, conversationId, senderId, clientMessageId));
        }
        catch (err) {
            this.logger.warn(`idempotency cache read failed: ${err.message}`);
            return null;
        }
    }
    async writeIdempotencyCache(projectId, conversationId, senderId, clientMessageId, messagePublicId) {
        try {
            await this.redisService.client.set(chat_constants_1.RedisKeys.idempotency(projectId, conversationId, senderId, clientMessageId), messagePublicId, 'EX', IDEMPOTENCY_CACHE_TTL_SECONDS);
        }
        catch (err) {
            this.logger.warn(`idempotency cache write failed: ${err.message}`);
        }
    }
};
exports.MessagesService = MessagesService;
exports.MessagesService = MessagesService = MessagesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService,
        conversations_service_1.ConversationsService,
        chat_events_service_1.ChatEventsService,
        chat_rate_limit_service_1.ChatRateLimitService,
        chat_metrics_service_1.ChatMetricsService,
        webhook_events_service_1.WebhookEventsService])
], MessagesService);
function isUniqueViolation(err) {
    return err?.code === 'P2002';
}
//# sourceMappingURL=messages.service.js.map