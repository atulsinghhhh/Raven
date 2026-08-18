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
exports.CreateRtcTokenDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const rtc_token_permissions_dto_1 = require("./rtc-token-permissions.dto");
const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;
class CreateRtcTokenDto {
    constructor() {
        this.permissions = new rtc_token_permissions_dto_1.RtcTokenPermissionsDto();
    }
}
exports.CreateRtcTokenDto = CreateRtcTokenDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'user-123',
        minLength: 1,
        maxLength: 128,
        description: 'Unique within the room. Letters, numbers, "-", "_", "." only.',
    }),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(128),
    (0, class_validator_1.Matches)(IDENTITY_PATTERN, {
        message: 'participantIdentity may only contain letters, numbers, "-", "_", and "."',
    }),
    __metadata("design:type", String)
], CreateRtcTokenDto.prototype, "participantIdentity", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: rtc_token_permissions_dto_1.RtcTokenPermissionsDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => rtc_token_permissions_dto_1.RtcTokenPermissionsDto),
    __metadata("design:type", rtc_token_permissions_dto_1.RtcTokenPermissionsDto)
], CreateRtcTokenDto.prototype, "permissions", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 600,
        minimum: 30,
        maximum: 21600,
        description: 'Token lifetime in seconds. Defaults to RTC_TOKEN_DEFAULT_TTL_SECONDS. There is no way to request a non-expiring token — every RTC token is short-lived by design.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(30, { message: 'ttlSeconds must be at least 30 seconds' }),
    (0, class_validator_1.Max)(21600, { message: 'ttlSeconds must be at most 21600 seconds (6 hours)' }),
    __metadata("design:type", Number)
], CreateRtcTokenDto.prototype, "ttlSeconds", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '{"displayName":"Alice"}', maxLength: 1024 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1024),
    __metadata("design:type", String)
], CreateRtcTokenDto.prototype, "metadata", void 0);
//# sourceMappingURL=create-rtc-token.dto.js.map