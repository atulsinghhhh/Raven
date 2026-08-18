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
exports.CreateAttachmentDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const MIME_PATTERN = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;
class CreateAttachmentDto {
}
exports.CreateAttachmentDto = CreateAttachmentDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'design-review.png', maxLength: 255 }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateAttachmentDto.prototype, "filename", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'image/png' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    (0, class_validator_1.Matches)(MIME_PATTERN, { message: 'mimeType must look like "type/subtype"' }),
    __metadata("design:type", String)
], CreateAttachmentDto.prototype, "mimeType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 184320,
        description: 'Declared size in bytes, checked against STORAGE_MAX_ATTACHMENT_BYTES before a URL is issued.',
    }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(1024 * 1024 * 1024),
    __metadata("design:type", Number)
], CreateAttachmentDto.prototype, "size", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'API-key callers only — ignored for browser chat tokens.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], CreateAttachmentDto.prototype, "uploaderId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Developer-owned JSON, e.g. image dimensions.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], CreateAttachmentDto.prototype, "metadata", void 0);
//# sourceMappingURL=create-attachment.dto.js.map