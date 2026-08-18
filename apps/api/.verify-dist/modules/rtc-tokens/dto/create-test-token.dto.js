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
exports.CreateTestTokenDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const IDENTITY_PATTERN = /^[a-zA-Z0-9_.-]+$/;
class CreateTestTokenDto {
}
exports.CreateTestTokenDto = CreateTestTokenDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'test-user',
        default: 'dashboard-test-user',
        minLength: 1,
        maxLength: 128,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(128),
    (0, class_validator_1.Matches)(IDENTITY_PATTERN, {
        message: 'participantIdentity may only contain letters, numbers, "-", "_", and "."',
    }),
    __metadata("design:type", String)
], CreateTestTokenDto.prototype, "participantIdentity", void 0);
//# sourceMappingURL=create-test-token.dto.js.map