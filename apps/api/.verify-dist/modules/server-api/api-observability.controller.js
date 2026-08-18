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
exports.ApiObservabilityController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_project_id_decorator_1 = require("../api-keys/decorators/current-project-id.decorator");
const api_key_auth_guard_1 = require("../api-keys/guards/api-key-auth.guard");
const connections_service_1 = require("../observability/connections.service");
const diagnostics_service_1 = require("../observability/diagnostics.service");
const query_connections_dto_1 = require("../observability/dto/query-connections.dto");
const query_errors_dto_1 = require("../observability/dto/query-errors.dto");
const errors_service_1 = require("../observability/errors.service");
const metrics_service_1 = require("../observability/metrics.service");
const projects_service_1 = require("../projects/projects.service");
let ApiObservabilityController = class ApiObservabilityController {
    constructor(connectionsService, errorsService, metricsService, diagnosticsService, projectsService) {
        this.connectionsService = connectionsService;
        this.errorsService = errorsService;
        this.metricsService = metricsService;
        this.diagnosticsService = diagnosticsService;
        this.projectsService = projectsService;
    }
    listConnections(projectId, query) {
        return this.connectionsService.listForProject(projectId, query);
    }
    getConnection(projectId, connectionId) {
        return this.connectionsService.getDetail(projectId, connectionId);
    }
    listErrors(projectId, query) {
        return this.errorsService.listForProject(projectId, query);
    }
    getError(projectId, errorId) {
        return this.errorsService.getDetail(projectId, errorId);
    }
    getMetrics(projectId, range) {
        return this.metricsService.getOverview(projectId, range);
    }
    async getDiagnostics(projectId) {
        const project = await this.projectsService.findOneById(projectId);
        return this.diagnosticsService.getDiagnostics(project);
    }
};
exports.ApiObservabilityController = ApiObservabilityController;
__decorate([
    (0, common_1.Get)('connections'),
    (0, swagger_1.ApiOperation)({ summary: "List the API key's project's real RTC connections" }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, query_connections_dto_1.QueryConnectionsDto]),
    __metadata("design:returntype", void 0)
], ApiObservabilityController.prototype, "listConnections", null);
__decorate([
    (0, common_1.Get)('connections/:connectionId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get one connection with its full event timeline and any errors' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Connection detail' }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __param(1, (0, common_1.Param)('connectionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ApiObservabilityController.prototype, "getConnection", null);
__decorate([
    (0, common_1.Get)('errors'),
    (0, swagger_1.ApiOperation)({ summary: "List the API key's project's classified errors" }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, query_errors_dto_1.QueryErrorsDto]),
    __metadata("design:returntype", void 0)
], ApiObservabilityController.prototype, "listErrors", null);
__decorate([
    (0, common_1.Get)('errors/:errorId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get one classified error, with its connection if any' }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __param(1, (0, common_1.Param)('errorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ApiObservabilityController.prototype, "getError", null);
__decorate([
    (0, common_1.Get)('metrics'),
    (0, swagger_1.ApiOperation)({ summary: 'Real aggregate connection/error metrics for the API key\'s project' }),
    (0, swagger_1.ApiQuery)({ name: 'range', required: false, enum: ['15m', '1h', '24h', '7d'] }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __param(1, (0, common_1.Query)('range')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ApiObservabilityController.prototype, "getMetrics", null);
__decorate([
    (0, common_1.Get)('diagnostics'),
    (0, swagger_1.ApiOperation)({ summary: "Authenticated per-dependency diagnostics for the API key's project" }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ApiObservabilityController.prototype, "getDiagnostics", null);
exports.ApiObservabilityController = ApiObservabilityController = __decorate([
    (0, swagger_1.ApiTags)('Server SDK — Observability'),
    (0, swagger_1.ApiBearerAuth)('apiKey'),
    (0, common_1.Controller)('v1'),
    (0, common_1.UseGuards)(api_key_auth_guard_1.ApiKeyAuthGuard),
    __metadata("design:paramtypes", [connections_service_1.ConnectionsService,
        errors_service_1.ErrorsService,
        metrics_service_1.MetricsService,
        diagnostics_service_1.DiagnosticsService,
        projects_service_1.ProjectsService])
], ApiObservabilityController);
//# sourceMappingURL=api-observability.controller.js.map