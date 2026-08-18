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
exports.CreateChatTokenDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const chat_permissions_1 = require("../../chat-permissions");
const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;
class CreateChatTokenDto {
}
exports.CreateChatTokenDto = CreateChatTokenDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'user-123',
        description: "The end user this token speaks for. Everything they send is attributed to this identity — the browser can never override it.",
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(128),
    (0, class_validator_1.Matches)(IDENTITY_PATTERN, { message: 'userId may only contain letters, numbers, "-", "_", and "."' }),
    __metadata("design:type", String)
], CreateChatTokenDto.prototype, "userId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        type: [String],
        maxItems: 20,
        description: 'Conversation references (conv_ id, uuid, or name) this token may touch. Omit to allow every conversation the user is a member of.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateChatTokenDto.prototype, "conversations", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        type: [String],
        enum: chat_permissions_1.CHAT_SCOPES,
        description: 'Narrows the token below what the user\'s role allows. Can only ever remove permissions — listing "chat:manage" here does not grant it.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(8),
    (0, class_validator_1.IsIn)(chat_permissions_1.CHAT_SCOPES, { each: true }),
    __metadata("design:type", Array)
], CreateChatTokenDto.prototype, "scopes", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 3600,
        minimum: 60,
        maximum: 21600,
        description: 'Lifetime in seconds. Defaults to CHAT_TOKEN_DEFAULT_TTL_SECONDS, capped at CHAT_TOKEN_MAX_TTL_SECONDS. There is no non-expiring chat token.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(60),
    (0, class_validator_1.Max)(21600),
    __metadata("design:type", Number)
], CreateChatTokenDto.prototype, "ttlSeconds", void 0);
//# sourceMappingURL=create-chat-token.dto.js.map