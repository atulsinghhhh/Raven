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
exports.ListMessagesDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class ListMessagesDto {
}
exports.ListMessagesDto = ListMessagesDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ minimum: 1, maximum: 100, default: 50 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], ListMessagesDto.prototype, "limit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Opaque cursor from a previous page\'s nextCursor — walks backwards into history. Cursor-based, not offset-based, so pages stay stable while new messages arrive.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(256),
    __metadata("design:type", String)
], ListMessagesDto.prototype, "before", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Opaque cursor that walks forward toward newer messages. This is how a client catches up on what it missed while disconnected.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(256),
    __metadata("design:type", String)
], ListMessagesDto.prototype, "after", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Restrict to one thread, by the root message\'s public id.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], ListMessagesDto.prototype, "threadRootId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Restrict to one sender.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], ListMessagesDto.prototype, "senderId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        default: false,
        description: 'Include soft-deleted messages as tombstones (no text). Useful for moderation views.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === true || value === 'true'),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ListMessagesDto.prototype, "includeDeleted", void 0);
//# sourceMappingURL=list-messages.dto.js.map