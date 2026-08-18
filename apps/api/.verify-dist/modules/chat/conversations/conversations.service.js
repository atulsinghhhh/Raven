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
exports.ConversationsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../../generated/prisma/client");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const app_error_1 = require("../../../shared/errors/app-error");
const crypto_util_1 = require("../../../shared/utils/crypto.util");
const json_util_1 = require("../json.util");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const chat_permissions_1 = require("../chat-permissions");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let ConversationsService = class ConversationsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(projectId, dto) {
        const existing = await this.prisma.conversation.findUnique({
            where: { projectId_name: { projectId, name: dto.name } },
        });
        if (existing) {
            throw new app_error_1.ConflictError(`A conversation named "${dto.name}" already exists in this project`);
        }
        if (dto.roomId) {
            const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
            if (!room || room.projectId !== projectId) {
                throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ROOM_NOT_FOUND, 'RTC room not found in this project');
            }
            const alreadyLinked = await this.prisma.conversation.findUnique({ where: { roomId: dto.roomId } });
            if (alreadyLinked) {
                throw new app_error_1.ConflictError(`RTC room "${room.name}" already has a conversation attached`);
            }
        }
        return this.prisma.conversation.create({
            data: {
                publicId: (0, crypto_util_1.generateId)('conv'),
                projectId,
                name: dto.name,
                type: dto.roomId ? client_1.ConversationType.ROOM : (dto.type ?? client_1.ConversationType.CHANNEL),
                roomId: dto.roomId,
                retentionDays: dto.retentionDays,
                metadata: (0, json_util_1.toJsonInput)(dto.metadata),
                members: dto.members?.length
                    ? {
                        create: dto.members.map((m) => ({
                            projectId,
                            userId: m.userId,
                            role: m.role ?? client_1.ChatMemberRole.MEMBER,
                        })),
                    }
                    : undefined,
            },
        });
    }
    listForProject(projectId, includeArchived = false) {
        return this.prisma.conversation.findMany({
            where: { projectId, ...(includeArchived ? {} : { status: client_1.ConversationStatus.ACTIVE }) },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
    }
    async update(projectId, reference, dto) {
        const conversation = await this.resolve(projectId, reference);
        return this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                name: dto.name,
                status: dto.status,
                retentionDays: dto.retentionDays,
                metadata: (0, json_util_1.toJsonInput)(dto.metadata),
            },
        });
    }
    async resolve(projectId, reference) {
        if (!reference || typeof reference !== 'string') {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ROOM_NOT_FOUND, 'A room/conversation reference is required');
        }
        let conversation = null;
        if (reference.startsWith('conv_')) {
            conversation = await this.prisma.conversation.findUnique({ where: { publicId: reference } });
        }
        else if (UUID_PATTERN.test(reference)) {
            conversation =
                (await this.prisma.conversation.findUnique({ where: { id: reference } })) ??
                    (await this.prisma.conversation.findUnique({ where: { roomId: reference } }));
        }
        else {
            conversation = await this.prisma.conversation.findUnique({
                where: { projectId_name: { projectId, name: reference } },
            });
        }
        if (!conversation || conversation.projectId !== projectId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ROOM_NOT_FOUND, `Conversation "${reference}" not found`);
        }
        return conversation;
    }
    async authorize(actor, reference) {
        const conversation = await this.resolve(actor.projectId, reference);
        if (actor.kind === 'client' &&
            actor.conversationScope?.length &&
            !actor.conversationScope.includes(conversation.id) &&
            !actor.conversationScope.includes(conversation.publicId)) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.PERMISSION_DENIED, 'This chat token is not scoped to that conversation');
        }
        if (actor.kind === 'server') {
            const member = actor.userId
                ? await this.prisma.chatMember.findUnique({
                    where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId } },
                })
                : null;
            return { conversation, member, scopes: actor.scopes };
        }
        const member = await this.prisma.chatMember.findUnique({
            where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId } },
        });
        if (!member || member.status === client_1.ChatMemberStatus.LEFT) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.NOT_A_MEMBER, 'You are not a member of this conversation');
        }
        const roleScopes = (0, chat_permissions_1.scopesForRole)(member.role);
        return { conversation, member, scopes: roleScopes.filter((s) => actor.scopes.includes(s)) };
    }
    assertWritable(conversation) {
        if (conversation.status !== client_1.ConversationStatus.ACTIVE) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.CONVERSATION_ARCHIVED, 'This conversation is archived');
        }
    }
    async addMember(projectId, reference, dto) {
        const conversation = await this.resolve(projectId, reference);
        return this.prisma.chatMember.upsert({
            where: { conversationId_userId: { conversationId: conversation.id, userId: dto.userId } },
            create: {
                conversationId: conversation.id,
                projectId,
                userId: dto.userId,
                role: dto.role ?? client_1.ChatMemberRole.MEMBER,
                metadata: (0, json_util_1.toJsonInput)(dto.metadata),
            },
            update: {
                role: dto.role ?? client_1.ChatMemberRole.MEMBER,
                status: client_1.ChatMemberStatus.ACTIVE,
                leftAt: null,
                metadata: (0, json_util_1.toJsonInput)(dto.metadata),
            },
        });
    }
    async removeMember(projectId, reference, userId) {
        const conversation = await this.resolve(projectId, reference);
        const member = await this.prisma.chatMember.findUnique({
            where: { conversationId_userId: { conversationId: conversation.id, userId } },
        });
        if (!member) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.NOT_A_MEMBER, 'That user is not a member of this conversation');
        }
        await this.prisma.chatMember.update({
            where: { id: member.id },
            data: { status: client_1.ChatMemberStatus.LEFT, leftAt: new Date() },
        });
    }
    listMembers(conversationId) {
        return this.prisma.chatMember.findMany({
            where: { conversationId, status: client_1.ChatMemberStatus.ACTIVE },
            orderBy: { joinedAt: 'asc' },
            take: 500,
        });
    }
    async roleFor(conversationIds, userId) {
        if (conversationIds.length === 0) {
            return client_1.ChatMemberRole.MEMBER;
        }
        const members = await this.prisma.chatMember.findMany({
            where: { conversationId: { in: conversationIds }, userId, status: client_1.ChatMemberStatus.ACTIVE },
            select: { role: true },
        });
        if (members.some((m) => m.role === client_1.ChatMemberRole.ADMIN))
            return client_1.ChatMemberRole.ADMIN;
        if (members.some((m) => m.role === client_1.ChatMemberRole.MODERATOR))
            return client_1.ChatMemberRole.MODERATOR;
        return client_1.ChatMemberRole.MEMBER;
    }
};
exports.ConversationsService = ConversationsService;
exports.ConversationsService = ConversationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ConversationsService);
//# sourceMappingURL=conversations.service.js.map