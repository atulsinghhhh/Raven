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
exports.WebhooksController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const projects_service_1 = require("../projects/projects.service");
const create_webhook_dto_1 = require("./dto/create-webhook.dto");
const update_webhook_dto_1 = require("./dto/update-webhook.dto");
const webhooks_service_1 = require("./webhooks.service");
let WebhooksController = class WebhooksController {
    constructor(projectsService, webhooksService) {
        this.projectsService = projectsService;
        this.webhooksService = webhooksService;
    }
    async create(user, projectId, dto) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.webhooksService.create(projectId, dto);
    }
    async list(user, projectId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.webhooksService.list(projectId);
    }
    async listDeliveries(user, projectId, webhookId, limit) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.webhooksService.listDeliveries(projectId, webhookId, limit ? Number(limit) : undefined);
    }
    async update(user, projectId, webhookId, dto) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.webhooksService.update(projectId, webhookId, dto);
    }
    async remove(user, projectId, webhookId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        await this.webhooksService.remove(projectId, webhookId);
    }
};
exports.WebhooksController = WebhooksController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Register a webhook endpoint',
        description: 'Returns the signing secret exactly once. Verify every delivery against it — see docs/chat/webhooks.md#verifying-a-delivery.',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Endpoint created; signing secret returned once' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, create_webhook_dto_1.CreateWebhookDto]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List webhook endpoints (signing secrets are never returned)' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':webhookId/deliveries'),
    (0, swagger_1.ApiOperation)({ summary: 'Delivery log for one endpoint — attempts, status, and truncated errors' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or endpoint not found' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('webhookId')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "listDeliveries", null);
__decorate([
    (0, common_1.Patch)(':webhookId'),
    (0, swagger_1.ApiOperation)({ summary: 'Update an endpoint, or re-enable one Raven auto-disabled' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or endpoint not found' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('webhookId')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, update_webhook_dto_1.UpdateWebhookDto]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':webhookId'),
    (0, common_1.HttpCode)(204),
    (0, swagger_1.ApiOperation)({ summary: 'Delete an endpoint and its delivery history' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or endpoint not found' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('webhookId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], WebhooksController.prototype, "remove", null);
exports.WebhooksController = WebhooksController = __decorate([
    (0, swagger_1.ApiTags)('Webhooks'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('v1/projects/:projectId/webhooks'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [projects_service_1.ProjectsService,
        webhooks_service_1.WebhooksService])
], WebhooksController);
//# sourceMappingURL=webhooks.controller.js.map