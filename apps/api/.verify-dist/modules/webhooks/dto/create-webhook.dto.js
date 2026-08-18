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
exports.CreateWebhookDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const webhook_events_service_1 = require("../webhook-events.service");
class CreateWebhookDto {
}
exports.CreateWebhookDto = CreateWebhookDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'https://api.example.com/raven/webhooks',
        description: 'Must be https:// in production. Loopback/private addresses are rejected outside local dev.',
    }),
    (0, class_validator_1.IsUrl)({ require_tld: false, require_protocol: true }),
    (0, class_validator_1.MaxLength)(2048),
    __metadata("design:type", String)
], CreateWebhookDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ maxLength: 256 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(256),
    __metadata("design:type", String)
], CreateWebhookDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        type: [String],
        enum: webhook_events_service_1.WEBHOOK_EVENT_TYPES,
        description: 'Omit or leave empty to receive every event type.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(32),
    (0, class_validator_1.IsIn)(webhook_events_service_1.WEBHOOK_EVENT_TYPES, { each: true }),
    __metadata("design:type", Array)
], CreateWebhookDto.prototype, "events", void 0);
//# sourceMappingURL=create-webhook.dto.js.map