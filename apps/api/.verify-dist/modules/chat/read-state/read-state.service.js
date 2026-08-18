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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadStateService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const chat_actor_interface_1 = require("../auth/chat-actor.interface");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const chat_permissions_1 = require("../chat-permissions");
const conversations_service_1 = require("../conversations/conversations.service");
const messages_service_1 = require("../messages/messages.service");
const chat_events_service_1 = require("../realtime/chat-events.service");
let ReadStateService = class ReadStateService {
    constructor(prisma, conversations, messages, events) {
        this.prisma = prisma;
        this.conversations = conversations;
        this.messages = messages;
        this.events = events;
    }
    async markRead(actor, messagePublicId) {
        const { message, conversation, scopes } = await this.messages.loadForActor(actor, messagePublicId);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:read', 'Marking a message read');
        const userId = (0, chat_actor_interface_1.resolveSubjectId)(actor, null);
        if (!userId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to mark messages read');
        }
        const existing = await this.prisma.readState.findUnique({
            where: { conversationId_userId: { conversationId: conversation.id, userId } },
        });
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
            type: chat_constants_1.ChatServerFrame.READ,
            conversationId: conversation.id,
            roomId: conversation.publicId,
            userId,
            messageId: message.publicId,
            at: new Date().toISOString(),
        });
        return this.view(conversation.publicId, userId, updated.lastReadMessageId, updated.lastReadAt, conversation.id);
    }
    async get(actor, roomReference) {
        const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:read', 'Reading read state');
        const userId = (0, chat_actor_interface_1.resolveSubjectId)(actor, null);
        if (!userId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to read read state');
        }
        const state = await this.prisma.readState.findUnique({
            where: { conversationId_userId: { conversationId: conversation.id, userId } },
        });
        return this.view(conversation.publicId, userId, state?.lastReadMessageId ?? null, state?.lastReadAt ?? new Date(0), conversation.id);
    }
    async listForConversation(actor, roomReference, limit = 200) {
        const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:read', 'Reading read receipts');
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
            unreadCount: 0,
        }));
    }
    async view(roomPublicId, userId, lastReadMessageInternalId, lastReadAt, conversationId) {
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
};
exports.ReadStateService = ReadStateService;
exports.ReadStateService = ReadStateService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        conversations_service_1.ConversationsService,
        messages_service_1.MessagesService,
        chat_events_service_1.ChatEventsService])
], ReadStateService);
//# sourceMappingURL=read-state.service.js.map