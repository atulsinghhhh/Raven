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
exports.SendMessageDto = exports.MESSAGE_TYPE_VALUES = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
exports.MESSAGE_TYPE_VALUES = ['text', 'system', 'event', 'attachment'];
class SendMessageDto {
}
exports.SendMessageDto = SendMessageDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Hello everyone!',
        description: 'Required for text messages. Length capped by CHAT_MAX_TEXT_LENGTH.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendMessageDto.prototype, "text", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: exports.MESSAGE_TYPE_VALUES,
        default: 'text',
        description: '"system" and "event" are server-only — a browser chat token cannot send them.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.MESSAGE_TYPE_VALUES),
    __metadata("design:type", String)
], SendMessageDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'msg_9WcQ4kRz1nB2xYtL',
        description: 'Public id of the message being replied to. Must be in the same conversation.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], SendMessageDto.prototype, "replyTo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'client_123',
        description: 'Idempotency key. Retrying a send with the same key returns the original message instead of creating a duplicate — which is what makes a reconnect-and-retry safe.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], SendMessageDto.prototype, "clientMessageId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Public id of an already-uploaded attachment (att_...).' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], SendMessageDto.prototype, "attachmentId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Developer-owned JSON. Capped by CHAT_MAX_METADATA_BYTES.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], SendMessageDto.prototype, "metadata", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'API-key callers only: the user this message is attributed to. Ignored for browser chat tokens, which always send as the token subject.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], SendMessageDto.prototype, "senderId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Client send timestamp (epoch ms), used only for latency measurement. Never trusted as createdAt — the server stamps that.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], SendMessageDto.prototype, "clientSentAt", void 0);
//# sourceMappingURL=send-message.dto.js.map