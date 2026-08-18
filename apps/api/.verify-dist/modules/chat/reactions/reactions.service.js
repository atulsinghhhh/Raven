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
exports.ReactionsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const webhook_events_service_1 = require("../../webhooks/webhook-events.service");
const chat_actor_interface_1 = require("../auth/chat-actor.interface");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const chat_permissions_1 = require("../chat-permissions");
const chat_metrics_service_1 = require("../metrics/chat-metrics.service");
const messages_service_1 = require("../messages/messages.service");
const message_serializer_1 = require("../messages/message.serializer");
const chat_rate_limit_service_1 = require("../rate-limit/chat-rate-limit.service");
const chat_events_service_1 = require("../realtime/chat-events.service");
const MAX_EMOJI_LENGTH = 32;
let ReactionsService = class ReactionsService {
    constructor(prisma, configService, messages, events, rateLimit, metrics, webhooks) {
        this.prisma = prisma;
        this.configService = configService;
        this.messages = messages;
        this.events = events;
        this.rateLimit = rateLimit;
        this.metrics = metrics;
        this.webhooks = webhooks;
    }
    async add(actor, messagePublicId, emoji) {
        const { message, conversation, scopes } = await this.messages.loadForActor(actor, messagePublicId);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:send', 'Reacting to a message');
        if (message.deletedAt) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_DELETED, 'Cannot react to a deleted message');
        }
        const userId = (0, chat_actor_interface_1.resolveSubjectId)(actor, null);
        if (!userId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to react');
        }
        assertEmoji(emoji);
        await this.rateLimit.consume('reaction', actor.projectId, userId);
        const maxReactions = this.configService.get('chat.maxReactionsPerMessage');
        const existingCount = await this.prisma.reaction.count({ where: { messageId: message.id } });
        if (existingCount >= maxReactions) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_TOO_LARGE, `This message already has the maximum of ${maxReactions} reactions`);
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
            update: {},
        });
        const reactions = await this.summarize(message.id);
        const at = new Date().toISOString();
        await this.events.publish(actor.projectId, conversation.id, {
            type: chat_constants_1.ChatServerFrame.REACTION_ADDED,
            conversationId: conversation.id,
            roomId: conversation.publicId,
            messageId: message.publicId,
            userId,
            emoji,
            at,
        });
        void this.webhooks.emit(actor.projectId, 'reaction.added', {
            messageId: message.publicId,
            roomId: conversation.publicId,
            userId,
            emoji,
            at,
        });
        this.metrics.increment(actor.projectId, 'messages_fanned_out');
        return { messageId: message.publicId, roomId: conversation.publicId, userId, emoji, reactions };
    }
    async remove(actor, messagePublicId, emoji) {
        const { message, conversation, scopes } = await this.messages.loadForActor(actor, messagePublicId);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:send', 'Removing a reaction');
        const userId = (0, chat_actor_interface_1.resolveSubjectId)(actor, null);
        if (!userId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'A user identity is required to remove a reaction');
        }
        assertEmoji(emoji);
        await this.prisma.reaction.deleteMany({ where: { messageId: message.id, userId, emoji } });
        const reactions = await this.summarize(message.id);
        const at = new Date().toISOString();
        await this.events.publish(actor.projectId, conversation.id, {
            type: chat_constants_1.ChatServerFrame.REACTION_REMOVED,
            conversationId: conversation.id,
            roomId: conversation.publicId,
            messageId: message.publicId,
            userId,
            emoji,
            at,
        });
        void this.webhooks.emit(actor.projectId, 'reaction.removed', {
            messageId: message.publicId,
            roomId: conversation.publicId,
            userId,
            emoji,
            at,
        });
        return { messageId: message.publicId, roomId: conversation.publicId, userId, emoji, reactions };
    }
    async summarize(messageId) {
        const rows = await this.prisma.reaction.findMany({ where: { messageId } });
        return (0, message_serializer_1.summarizeReactions)(rows);
    }
};
exports.ReactionsService = ReactionsService;
exports.ReactionsService = ReactionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        messages_service_1.MessagesService,
        chat_events_service_1.ChatEventsService,
        chat_rate_limit_service_1.ChatRateLimitService,
        chat_metrics_service_1.ChatMetricsService,
        webhook_events_service_1.WebhookEventsService])
], ReactionsService);
function assertEmoji(emoji) {
    if (typeof emoji !== 'string' || emoji.trim().length === 0) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'An emoji is required');
    }
    if (emoji.length > MAX_EMOJI_LENGTH) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_TOO_LARGE, `Reaction is too long — the limit is ${MAX_EMOJI_LENGTH} characters`);
    }
}
//# sourceMappingURL=reactions.service.js.map