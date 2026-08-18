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
exports.ApiKeysController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const rate_limit_decorator_1 = require("../../shared/rate-limit/rate-limit.decorator");
const rate_limit_guard_1 = require("../../shared/rate-limit/rate-limit.guard");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const projects_service_1 = require("../projects/projects.service");
const api_keys_service_1 = require("./api-keys.service");
const create_api_key_dto_1 = require("./dto/create-api-key.dto");
let ApiKeysController = class ApiKeysController {
    constructor(apiKeysService, projectsService) {
        this.apiKeysService = apiKeysService;
        this.projectsService = projectsService;
    }
    async create(user, projectId, dto) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        const created = await this.apiKeysService.create(projectId, dto);
        return {
            ...created,
            warning: 'This is the only time the full key is shown. Store it securely — it cannot be retrieved again.',
        };
    }
    async findAll(user, projectId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.apiKeysService.findAllForProject(projectId);
    }
    async revoke(user, projectId, keyId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        await this.apiKeysService.revoke(projectId, keyId);
    }
};
exports.ApiKeysController = ApiKeysController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard),
    (0, rate_limit_decorator_1.RateLimit)(20),
    (0, swagger_1.ApiOperation)({
        summary: 'Create a project API key',
        description: 'The full key (publicId.secret) is returned ONLY in this response — it is never recoverable afterward, since only a bcrypt hash of it is stored. Rate limited to 20 requests/window/IP.',
    }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        description: 'Key created — copy the `key` field now, it will not be shown again',
        schema: {
            example: {
                id: '15633d21-c086-4d30-b326-cc75518cf369',
                name: 'production-server',
                publicId: 'rvk_TugSAioScTjb',
                key: 'rvk_TugSAioScTjb.roU60yZAdaa72T2tov2Mzf9E8aQ1gJL1gvdAESyMabA',
                createdAt: '2026-08-17T15:09:48.859Z',
                warning: 'This is the only time the full key is shown. Store it securely — it cannot be retrieved again.',
            },
        },
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Rate limit exceeded' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, create_api_key_dto_1.CreateApiKeyDto]),
    __metadata("design:returntype", Promise)
], ApiKeysController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({
        summary: "List a project's API keys",
        description: 'Never includes the secret or its hash — only publicId, name, status, and timestamps.',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Keys for this project (secrets never included)' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ApiKeysController.prototype, "findAll", null);
__decorate([
    (0, common_1.Delete)(':keyId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({
        summary: 'Revoke an API key',
        description: 'Immediate and permanent — a revoked key can never authenticate again.',
    }),
    (0, swagger_1.ApiResponse)({ status: 204, description: 'Key revoked' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or key not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('keyId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ApiKeysController.prototype, "revoke", null);
exports.ApiKeysController = ApiKeysController = __decorate([
    (0, swagger_1.ApiTags)('API Keys'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('v1/projects/:projectId/api-keys'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [api_keys_service_1.ApiKeysService,
        projects_service_1.ProjectsService])
], ApiKeysController);
//# sourceMappingURL=api-keys.controller.js.map