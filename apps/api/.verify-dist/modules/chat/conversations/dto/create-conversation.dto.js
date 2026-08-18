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
exports.CreateConversationDto = exports.ConversationMemberDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const client_1 = require("../../../../generated/prisma/client");
const CONVERSATION_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
class ConversationMemberDto {
}
exports.ConversationMemberDto = ConversationMemberDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'user-123', maxLength: 128 }),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(128),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ConversationMemberDto.prototype, "userId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: Object.values(client_1.ChatMemberRole), default: client_1.ChatMemberRole.MEMBER }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(Object.values(client_1.ChatMemberRole)),
    __metadata("design:type", String)
], ConversationMemberDto.prototype, "role", void 0);
class CreateConversationDto {
}
exports.CreateConversationDto = CreateConversationDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'support-room-42',
        description: 'Unique within the project. Doubles as a human-readable handle for chat.connect({ room }).',
    }),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(128),
    (0, class_validator_1.Matches)(CONVERSATION_NAME_PATTERN, {
        message: 'name may only contain letters, numbers, "-", "_", and "."',
    }),
    __metadata("design:type", String)
], CreateConversationDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: Object.values(client_1.ConversationType),
        default: client_1.ConversationType.CHANNEL,
        description: 'Ignored when roomId is set — attaching an RTC room always produces a ROOM conversation.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(Object.values(client_1.ConversationType)),
    __metadata("design:type", String)
], CreateConversationDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Attach this conversation to an existing RTC room, giving that video call a chat panel.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateConversationDto.prototype, "roomId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ minimum: 1, maximum: 3650, description: 'Overrides CHAT_RETENTION_DAYS for this conversation.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(3650),
    __metadata("design:type", Number)
], CreateConversationDto.prototype, "retentionDays", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [ConversationMemberDto], maxItems: 100 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ConversationMemberDto),
    __metadata("design:type", Array)
], CreateConversationDto.prototype, "members", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arbitrary developer-owned JSON. Size-capped like message metadata.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], CreateConversationDto.prototype, "metadata", void 0);
//# sourceMappingURL=create-conversation.dto.js.map