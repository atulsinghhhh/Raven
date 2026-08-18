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
exports.UpdateWebhookDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const client_1 = require("../../../generated/prisma/client");
const webhook_events_service_1 = require("../webhook-events.service");
class UpdateWebhookDto {
}
exports.UpdateWebhookDto = UpdateWebhookDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)({ require_tld: false, require_protocol: true }),
    (0, class_validator_1.MaxLength)(2048),
    __metadata("design:type", String)
], UpdateWebhookDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(256),
    __metadata("design:type", String)
], UpdateWebhookDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String], enum: webhook_events_service_1.WEBHOOK_EVENT_TYPES }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(32),
    (0, class_validator_1.IsIn)(webhook_events_service_1.WEBHOOK_EVENT_TYPES, { each: true }),
    __metadata("design:type", Array)
], UpdateWebhookDto.prototype, "events", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: Object.values(client_1.WebhookEndpointStatus),
        description: 'Set back to ACTIVE to re-enable an endpoint Raven auto-disabled after repeated failures.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(Object.values(client_1.WebhookEndpointStatus)),
    __metadata("design:type", String)
], UpdateWebhookDto.prototype, "status", void 0);
//# sourceMappingURL=update-webhook.dto.js.map