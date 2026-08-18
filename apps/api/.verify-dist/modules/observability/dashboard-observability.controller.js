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
exports.DashboardObservabilityController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const projects_service_1 = require("../projects/projects.service");
const connections_service_1 = require("./connections.service");
const diagnostics_service_1 = require("./diagnostics.service");
const query_connections_dto_1 = require("./dto/query-connections.dto");
const query_errors_dto_1 = require("./dto/query-errors.dto");
const errors_service_1 = require("./errors.service");
const metrics_service_1 = require("./metrics.service");
let DashboardObservabilityController = class DashboardObservabilityController {
    constructor(projectsService, connectionsService, errorsService, metricsService, diagnosticsService) {
        this.projectsService = projectsService;
        this.connectionsService = connectionsService;
        this.errorsService = errorsService;
        this.metricsService = metricsService;
        this.diagnosticsService = diagnosticsService;
    }
    async listConnections(user, projectId, query) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.connectionsService.listForProject(projectId, query);
    }
    async getConnection(user, projectId, connectionId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.connectionsService.getDetail(projectId, connectionId);
    }
    async listErrors(user, projectId, query) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.errorsService.listForProject(projectId, query);
    }
    async getError(user, projectId, errorId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.errorsService.getDetail(projectId, errorId);
    }
    async getMetrics(user, projectId, range) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.metricsService.getOverview(projectId, range);
    }
    async getDiagnostics(user, projectId) {
        const project = await this.projectsService.findOneForOwner(projectId, user.id);
        return this.diagnosticsService.getDiagnostics(project);
    }
};
exports.DashboardObservabilityController = DashboardObservabilityController;
__decorate([
    (0, common_1.Get)('connections'),
    (0, swagger_1.ApiOperation)({ summary: "List a project's real RTC connections" }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, query_connections_dto_1.QueryConnectionsDto]),
    __metadata("design:returntype", Promise)
], DashboardObservabilityController.prototype, "listConnections", null);
__decorate([
    (0, common_1.Get)('connections/:connectionId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get one connection with its full event timeline and any errors' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or connection not found' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('connectionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], DashboardObservabilityController.prototype, "getConnection", null);
__decorate([
    (0, common_1.Get)('errors'),
    (0, swagger_1.ApiOperation)({ summary: "List a project's classified errors" }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, query_errors_dto_1.QueryErrorsDto]),
    __metadata("design:returntype", Promise)
], DashboardObservabilityController.prototype, "listErrors", null);
__decorate([
    (0, common_1.Get)('errors/:errorId'),
    (0, swagger_1.ApiOperation)({ summary: 'Get one classified error, with its connection if any' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or error not found' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('errorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], DashboardObservabilityController.prototype, "getError", null);
__decorate([
    (0, common_1.Get)('metrics'),
    (0, swagger_1.ApiOperation)({ summary: 'Real aggregate connection/error metrics for this project' }),
    (0, swagger_1.ApiQuery)({ name: 'range', required: false, enum: ['15m', '1h', '24h', '7d'] }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Query)('range')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], DashboardObservabilityController.prototype, "getMetrics", null);
__decorate([
    (0, common_1.Get)('diagnostics'),
    (0, swagger_1.ApiOperation)({ summary: 'Authenticated per-dependency diagnostics for this project' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'API/auth/signaling/SFU/TURN status plus active connection count' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DashboardObservabilityController.prototype, "getDiagnostics", null);
exports.DashboardObservabilityController = DashboardObservabilityController = __decorate([
    (0, swagger_1.ApiTags)('Dashboard — Observability'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('v1/projects/:projectId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [projects_service_1.ProjectsService,
        connections_service_1.ConnectionsService,
        errors_service_1.ErrorsService,
        metrics_service_1.MetricsService,
        diagnostics_service_1.DiagnosticsService])
], DashboardObservabilityController);
//# sourceMappingURL=dashboard-observability.controller.js.map