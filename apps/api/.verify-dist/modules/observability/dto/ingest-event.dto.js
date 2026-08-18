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
exports.IngestEventDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const observability_constants_1 = require("../observability.constants");
class IngestEventDto {
}
exports.IngestEventDto = IngestEventDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'conn_01J8Z3K9QK2Y8V6ZC7B5R9F0XN', description: "The client-generated connection ID (Room's own, stable for its lifetime)." }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^conn_/, { message: 'connectionId must be a Raven connection ID (conn_...)' }),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], IngestEventDto.prototype, "connectionId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: observability_constants_1.CONNECTION_EVENT_TYPES }),
    (0, class_validator_1.IsIn)(observability_constants_1.CONNECTION_EVENT_TYPES),
    __metadata("design:type", Object)
], IngestEventDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Defaults to server receipt time if omitted.' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsISO8601)(),
    __metadata("design:type", String)
], IngestEventDto.prototype, "timestamp", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Small, developer-safe metadata bag — never raw audio/video, never secrets.',
        example: { sdkVersion: '0.1.0', platform: 'web', browser: 'chrome' },
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], IngestEventDto.prototype, "data", void 0);
//# sourceMappingURL=ingest-event.dto.js.map