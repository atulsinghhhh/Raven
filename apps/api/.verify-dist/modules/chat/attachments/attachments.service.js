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
var AttachmentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachmentsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
const client_1 = require("../../../generated/prisma/client");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const crypto_util_1 = require("../../../shared/utils/crypto.util");
const json_util_1 = require("../json.util");
const chat_actor_interface_1 = require("../auth/chat-actor.interface");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const chat_permissions_1 = require("../chat-permissions");
const conversations_service_1 = require("../conversations/conversations.service");
const s3_presign_util_1 = require("./s3-presign.util");
let AttachmentsService = AttachmentsService_1 = class AttachmentsService {
    constructor(prisma, configService, conversations) {
        this.prisma = prisma;
        this.configService = configService;
        this.conversations = conversations;
        this.logger = new common_1.Logger(AttachmentsService_1.name);
    }
    isConfigured() {
        const storage = this.storageConfig();
        return Boolean(storage.bucket && storage.endpoint && storage.accessKeyId && storage.secretAccessKey);
    }
    async createUploadTicket(actor, roomReference, dto) {
        const storage = this.requireStorage();
        const { conversation, scopes } = await this.conversations.authorize(actor, roomReference);
        this.conversations.assertWritable(conversation);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:send', 'Uploading an attachment');
        const uploaderId = (0, chat_actor_interface_1.resolveSubjectId)(actor, dto.uploaderId);
        if (!uploaderId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'An uploader identity is required');
        }
        const maxBytes = this.configService.get('storage.maxAttachmentBytes');
        if (dto.size > maxBytes) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ATTACHMENT_TOO_LARGE, `Attachment is ${dto.size} bytes — the limit is ${maxBytes}`);
        }
        const storageKey = `chat/${actor.projectId}/${conversation.id}/${(0, crypto_1.randomBytes)(16).toString('hex')}`;
        const ttl = this.configService.get('storage.uploadUrlTtlSeconds');
        const attachment = await this.prisma.attachment.create({
            data: {
                publicId: (0, crypto_util_1.generateId)('att'),
                projectId: actor.projectId,
                conversationId: conversation.id,
                uploaderId,
                filename: sanitizeFilename(dto.filename),
                mimeType: dto.mimeType,
                sizeBytes: dto.size,
                storageKey,
                metadata: (0, json_util_1.toJsonInput)(dto.metadata),
            },
        });
        const uploadUrl = (0, s3_presign_util_1.presignS3Url)({
            ...storage,
            method: 'PUT',
            key: storageKey,
            expiresInSeconds: ttl,
            contentType: dto.mimeType,
        });
        return {
            ...this.toTicketBase(attachment, conversation.publicId),
            uploadUrl,
            uploadMethod: 'PUT',
            uploadHeaders: { 'content-type': dto.mimeType },
            expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        };
    }
    async complete(actor, attachmentPublicId) {
        const attachment = await this.loadForActor(actor, attachmentPublicId);
        const uploaderId = (0, chat_actor_interface_1.resolveSubjectId)(actor, null);
        if (actor.kind === 'client' && attachment.uploaderId !== uploaderId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.PERMISSION_DENIED, 'That attachment was uploaded by someone else');
        }
        return this.prisma.attachment.update({
            where: { id: attachment.id },
            data: { status: client_1.AttachmentStatus.UPLOADED, uploadedAt: new Date() },
        });
    }
    async createDownloadUrl(actor, attachmentPublicId) {
        const storage = this.requireStorage();
        const attachment = await this.loadForActor(actor, attachmentPublicId);
        if (attachment.status !== client_1.AttachmentStatus.UPLOADED) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ATTACHMENT_NOT_FOUND, 'That attachment has not finished uploading');
        }
        const ttl = this.configService.get('storage.downloadUrlTtlSeconds');
        return {
            url: (0, s3_presign_util_1.presignS3Url)({ ...storage, method: 'GET', key: attachment.storageKey, expiresInSeconds: ttl }),
            expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        };
    }
    async loadForActor(actor, attachmentPublicId) {
        const attachment = await this.prisma.attachment.findUnique({ where: { publicId: attachmentPublicId } });
        if (!attachment || attachment.projectId !== actor.projectId) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ATTACHMENT_NOT_FOUND, `Attachment "${attachmentPublicId}" not found`);
        }
        const conversation = await this.prisma.conversation.findUniqueOrThrow({
            where: { id: attachment.conversationId },
        });
        const { scopes } = await this.conversations.authorize(actor, conversation.publicId);
        (0, chat_permissions_1.assertScope)(scopes, 'chat:read', 'Accessing an attachment');
        return attachment;
    }
    toTicketBase(attachment, roomPublicId) {
        return {
            id: attachment.publicId,
            roomId: roomPublicId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.sizeBytes,
            storageKey: attachment.storageKey,
            status: attachment.status.toLowerCase(),
        };
    }
    storageConfig() {
        return {
            endpoint: this.configService.get('storage.endpoint'),
            region: this.configService.get('storage.region'),
            bucket: this.configService.get('storage.bucket'),
            accessKeyId: this.configService.get('storage.accessKeyId'),
            secretAccessKey: this.configService.get('storage.secretAccessKey'),
            forcePathStyle: this.configService.get('storage.forcePathStyle'),
        };
    }
    requireStorage() {
        const storage = this.storageConfig();
        if (!storage.bucket || !storage.endpoint || !storage.accessKeyId || !storage.secretAccessKey) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ATTACHMENTS_NOT_CONFIGURED, 'Attachments are not enabled — set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY (see docs/chat/attachments.md)');
        }
        return storage;
    }
};
exports.AttachmentsService = AttachmentsService;
exports.AttachmentsService = AttachmentsService = AttachmentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        conversations_service_1.ConversationsService])
], AttachmentsService);
function sanitizeFilename(filename) {
    const cleaned = filename
        .replace(/[\\/]/g, '_')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .slice(0, 255)
        .trim();
    return cleaned || 'file';
}
//# sourceMappingURL=attachments.service.js.map