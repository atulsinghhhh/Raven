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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("../../../generated/prisma/client");
const attachments_service_1 = require("../attachments/attachments.service");
const create_attachment_dto_1 = require("../attachments/dto/create-attachment.dto");
const chat_auth_guard_1 = require("../auth/chat-auth.guard");
const current_chat_actor_decorator_1 = require("../auth/decorators/current-chat-actor.decorator");
const add_member_dto_1 = require("../conversations/dto/add-member.dto");
const create_conversation_dto_1 = require("../conversations/dto/create-conversation.dto");
const update_conversation_dto_1 = require("../conversations/dto/update-conversation.dto");
const conversations_service_1 = require("../conversations/conversations.service");
const list_messages_dto_1 = require("../messages/dto/list-messages.dto");
const send_message_dto_1 = require("../messages/dto/send-message.dto");
const update_message_dto_1 = require("../messages/dto/update-message.dto");
const messages_service_1 = require("../messages/messages.service");
const presence_service_1 = require("../presence/presence.service");
const reactions_service_1 = require("../reactions/reactions.service");
const read_state_service_1 = require("../read-state/read-state.service");
const create_chat_token_dto_1 = require("../tokens/dto/create-chat-token.dto");
const chat_token_service_1 = require("../tokens/chat-token.service");
const typing_service_1 = require("../typing/typing.service");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
let ChatController = class ChatController {
    constructor(conversations, messages, reactions, readState, presence, typing, attachments, chatTokens) {
        this.conversations = conversations;
        this.messages = messages;
        this.reactions = reactions;
        this.readState = readState;
        this.presence = presence;
        this.typing = typing;
        this.attachments = attachments;
        this.chatTokens = chatTokens;
    }
    async createToken(actor, dto) {
        assertServerActor(actor, 'Minting a chat token');
        const conversationIds = await Promise.all((dto.conversations ?? []).map(async (reference) => {
            const conversation = await this.conversations.resolve(actor.projectId, reference);
            return conversation.id;
        }));
        const role = await this.conversations.roleFor(conversationIds, dto.userId);
        return this.chatTokens.issue({
            projectId: actor.projectId,
            userId: dto.userId,
            conversations: conversationIds,
            role: role ?? client_1.ChatMemberRole.MEMBER,
            requestedScopes: dto.scopes,
            ttlSeconds: dto.ttlSeconds,
        });
    }
    async createConversation(actor, dto) {
        assertServerActor(actor, 'Creating a conversation');
        return this.conversations.create(actor.projectId, dto);
    }
    async listConversations(actor, includeArchived) {
        assertServerActor(actor, 'Listing every conversation in a project');
        return this.conversations.listForProject(actor.projectId, includeArchived === 'true');
    }
    async getConversation(actor, room) {
        const { conversation } = await this.conversations.authorize(actor, room);
        return conversation;
    }
    async updateConversation(actor, room, dto) {
        assertServerActor(actor, 'Updating a conversation');
        return this.conversations.update(actor.projectId, room, dto);
    }
    async addMember(actor, room, dto) {
        assertServerActor(actor, 'Adding a member');
        return this.conversations.addMember(actor.projectId, room, dto);
    }
    async listMembers(actor, room) {
        const { conversation } = await this.conversations.authorize(actor, room);
        return this.conversations.listMembers(conversation.id);
    }
    async removeMember(actor, room, userId) {
        assertServerActor(actor, 'Removing a member');
        await this.conversations.removeMember(actor.projectId, room, userId);
    }
    async listMessages(actor, room, query) {
        return this.messages.list(actor, room, query);
    }
    async sendMessage(actor, room, dto) {
        const result = await this.messages.send(actor, room, dto);
        return { ...result.message, deduplicated: result.deduplicated };
    }
    getMessage(actor, messageId) {
        return this.messages.get(actor, messageId);
    }
    listThread(actor, messageId) {
        return this.messages.listThread(actor, messageId);
    }
    updateMessage(actor, messageId, dto) {
        return this.messages.update(actor, messageId, dto);
    }
    deleteMessage(actor, messageId) {
        return this.messages.delete(actor, messageId);
    }
    addReaction(actor, messageId, emoji) {
        return this.reactions.add(actor, messageId, emoji);
    }
    removeReaction(actor, messageId, emoji) {
        return this.reactions.remove(actor, messageId, decodeURIComponent(emoji));
    }
    markRead(actor, messageId) {
        return this.readState.markRead(actor, messageId);
    }
    getReadState(actor, room) {
        return this.readState.get(actor, room);
    }
    listReadReceipts(actor, room) {
        return this.readState.listForConversation(actor, room);
    }
    async listPresence(actor, room) {
        const { conversation } = await this.conversations.authorize(actor, room);
        return this.presence.list(actor.projectId, conversation.id);
    }
    async listTyping(actor, room) {
        const { conversation } = await this.conversations.authorize(actor, room);
        return { userIds: await this.typing.list(actor.projectId, conversation.id) };
    }
    createAttachment(actor, room, dto) {
        return this.attachments.createUploadTicket(actor, room, dto);
    }
    completeAttachment(actor, attachmentId) {
        return this.attachments.complete(actor, attachmentId);
    }
    createDownloadUrl(actor, attachmentId) {
        return this.attachments.createDownloadUrl(actor, attachmentId);
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Post)('tokens'),
    (0, swagger_1.ApiOperation)({
        summary: 'Mint a short-lived chat token for one of your users',
        description: 'Call this from your backend with a project API key, then hand the token to the browser. Never ship an API key to a browser, and never mint a token in one.',
    }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        description: 'Token minted',
        schema: {
            example: {
                token: 'eyJhbGciOiJIUzI1NiJ9...',
                tokenId: 'ctk_7Qd2nF...',
                userId: 'user-123',
                scopes: ['chat:read', 'chat:send'],
                chatUrl: 'wss://api.example.com/v1/chat/ws',
                apiUrl: 'https://api.example.com',
                expiresAt: '2026-08-18T13:19:49.233Z',
            },
        },
    }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_chat_token_dto_1.CreateChatTokenDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "createToken", null);
__decorate([
    (0, common_1.Post)('conversations'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a conversation, optionally attached to an RTC room' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_conversation_dto_1.CreateConversationDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "createConversation", null);
__decorate([
    (0, common_1.Get)('conversations'),
    (0, swagger_1.ApiOperation)({ summary: "List the project's conversations" }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Query)('includeArchived')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "listConversations", null);
__decorate([
    (0, common_1.Get)('conversations/:room'),
    (0, swagger_1.ApiOperation)({ summary: 'Get one conversation by conv_ id, uuid, RTC room id, or name' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Conversation not found in this project' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getConversation", null);
__decorate([
    (0, common_1.Patch)('conversations/:room'),
    (0, swagger_1.ApiOperation)({ summary: 'Rename, archive, or re-configure retention for a conversation' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_conversation_dto_1.UpdateConversationDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "updateConversation", null);
__decorate([
    (0, common_1.Post)('conversations/:room/members'),
    (0, swagger_1.ApiOperation)({ summary: 'Add or re-activate a member' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, add_member_dto_1.AddMemberDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "addMember", null);
__decorate([
    (0, common_1.Get)('conversations/:room/members'),
    (0, swagger_1.ApiOperation)({ summary: 'List active members' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "listMembers", null);
__decorate([
    (0, common_1.Delete)('conversations/:room/members/:userId'),
    (0, common_1.HttpCode)(204),
    (0, swagger_1.ApiOperation)({ summary: 'Remove a member (soft — their messages keep a resolvable author)' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __param(2, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "removeMember", null);
__decorate([
    (0, common_1.Get)('conversations/:room/messages'),
    (0, swagger_1.ApiOperation)({
        summary: 'Message history, newest first, cursor-paginated',
        description: 'Use `before` to page back through history and `after` to catch up on what arrived while disconnected. Cursors are opaque — pass back exactly what the previous page returned.',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: { example: { data: [], nextCursor: 'MjAyNi0wOC0xOFQx...', previousCursor: null, hasMore: false } },
    }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, list_messages_dto_1.ListMessagesDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "listMessages", null);
__decorate([
    (0, common_1.Post)('conversations/:room/messages'),
    (0, swagger_1.ApiOperation)({
        summary: 'Send a message',
        description: 'Returns only after the message is durably stored — the id and createdAt in the response are canonical. Pass clientMessageId to make retries idempotent.',
    }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Per-user send rate limit exceeded' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, send_message_dto_1.SendMessageDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "sendMessage", null);
__decorate([
    (0, common_1.Get)('messages/:messageId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get one message' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "getMessage", null);
__decorate([
    (0, common_1.Get)('messages/:messageId/thread'),
    (0, swagger_1.ApiOperation)({ summary: 'Every message in this message\'s thread, oldest first' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "listThread", null);
__decorate([
    (0, common_1.Patch)('messages/:messageId'),
    (0, swagger_1.ApiOperation)({ summary: 'Edit a message — sets editedAt and returns edited: true' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('messageId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_message_dto_1.UpdateMessageDto]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "updateMessage", null);
__decorate([
    (0, common_1.Delete)('messages/:messageId'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft-delete a message; emits message.deleted' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "deleteMessage", null);
__decorate([
    (0, common_1.Post)('messages/:messageId/reactions'),
    (0, swagger_1.ApiOperation)({ summary: 'Add a reaction (idempotent per user+emoji)' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('messageId')),
    __param(2, (0, common_1.Body)('emoji')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "addReaction", null);
__decorate([
    (0, common_1.Delete)('messages/:messageId/reactions/:emoji'),
    (0, swagger_1.ApiOperation)({ summary: 'Remove a reaction' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('messageId')),
    __param(2, (0, common_1.Param)('emoji')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "removeReaction", null);
__decorate([
    (0, common_1.Post)('messages/:messageId/read'),
    (0, swagger_1.ApiOperation)({ summary: 'Mark this message — and everything before it — as read' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "markRead", null);
__decorate([
    (0, common_1.Get)('conversations/:room/read-state'),
    (0, swagger_1.ApiOperation)({ summary: 'Your read position and unread count for this conversation' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "getReadState", null);
__decorate([
    (0, common_1.Get)('conversations/:room/read-receipts'),
    (0, swagger_1.ApiOperation)({ summary: "Every member's read position — what a \"seen by\" row is built from" }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "listReadReceipts", null);
__decorate([
    (0, common_1.Get)('conversations/:room/presence'),
    (0, swagger_1.ApiOperation)({ summary: 'Who is present right now. Ephemeral — never read from Postgres.' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "listPresence", null);
__decorate([
    (0, common_1.Get)('conversations/:room/typing'),
    (0, swagger_1.ApiOperation)({ summary: 'Who is typing right now' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "listTyping", null);
__decorate([
    (0, common_1.Post)('conversations/:room/attachments'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get a signed upload URL',
        description: 'Upload the bytes straight to object storage with the returned URL, call /complete, then send a message referencing the attachment id. Files never pass through Raven or the WebSocket.',
    }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('room')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, create_attachment_dto_1.CreateAttachmentDto]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "createAttachment", null);
__decorate([
    (0, common_1.Post)('attachments/:attachmentId/complete'),
    (0, swagger_1.ApiOperation)({ summary: 'Confirm the upload finished, making the attachment sendable' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('attachmentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "completeAttachment", null);
__decorate([
    (0, common_1.Get)('attachments/:attachmentId/download-url'),
    (0, swagger_1.ApiOperation)({ summary: 'Short-lived signed download URL for an attachment you can see' }),
    __param(0, (0, current_chat_actor_decorator_1.CurrentChatActor)()),
    __param(1, (0, common_1.Param)('attachmentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "createDownloadUrl", null);
exports.ChatController = ChatController = __decorate([
    (0, swagger_1.ApiTags)('Chat'),
    (0, swagger_1.ApiBearerAuth)('apiKey'),
    (0, swagger_1.ApiBearerAuth)('chatToken'),
    (0, common_1.Controller)('v1/chat'),
    (0, common_1.UseGuards)(chat_auth_guard_1.ChatAuthGuard),
    __metadata("design:paramtypes", [conversations_service_1.ConversationsService,
        messages_service_1.MessagesService,
        reactions_service_1.ReactionsService,
        read_state_service_1.ReadStateService,
        presence_service_1.PresenceService,
        typing_service_1.TypingService,
        attachments_service_1.AttachmentsService,
        chat_token_service_1.ChatTokenService])
], ChatController);
function assertServerActor(actor, action) {
    if (actor.kind !== 'server') {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.PERMISSION_DENIED, `${action} requires a project API key, not a browser chat token`);
    }
}
//# sourceMappingURL=chat.controller.js.map