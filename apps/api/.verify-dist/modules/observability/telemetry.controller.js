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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const rate_limit_decorator_1 = require("../../shared/rate-limit/rate-limit.decorator");
const rate_limit_guard_1 = require("../../shared/rate-limit/rate-limit.guard");
const connections_service_1 = require("./connections.service");
const current_telemetry_context_decorator_1 = require("./decorators/current-telemetry-context.decorator");
const ingest_event_dto_1 = require("./dto/ingest-event.dto");
const telemetry_ingest_guard_1 = require("./guards/telemetry-ingest.guard");
let TelemetryController = class TelemetryController {
    constructor(connectionsService) {
        this.connectionsService = connectionsService;
    }
    async ingest(ctx, dto) {
        await this.connectionsService.recordEvent(ctx, dto);
    }
};
exports.TelemetryController = TelemetryController;
__decorate([
    (0, common_1.Post)('events'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard),
    (0, rate_limit_decorator_1.RateLimit)(600),
    (0, swagger_1.ApiOperation)({ summary: 'Best-effort ingestion of one RTC connection/participant/error event' }),
    (0, swagger_1.ApiResponse)({ status: 204, description: 'Event recorded' }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Rate limit exceeded' }),
    __param(0, (0, current_telemetry_context_decorator_1.CurrentTelemetryContext)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ingest_event_dto_1.IngestEventDto]),
    __metadata("design:returntype", Promise)
], TelemetryController.prototype, "ingest", null);
exports.TelemetryController = TelemetryController = __decorate([
    (0, swagger_1.ApiTags)('Telemetry'),
    (0, swagger_1.ApiBearerAuth)('rtcToken'),
    (0, common_1.Controller)('v1/telemetry'),
    (0, common_1.UseGuards)(telemetry_ingest_guard_1.TelemetryIngestGuard),
    __metadata("design:paramtypes", [connections_service_1.ConnectionsService])
], TelemetryController);
//# sourceMappingURL=telemetry.controller.js.map