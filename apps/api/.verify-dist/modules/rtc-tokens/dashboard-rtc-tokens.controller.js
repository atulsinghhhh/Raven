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
exports.DashboardRtcTokensController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const rate_limit_decorator_1 = require("../../shared/rate-limit/rate-limit.decorator");
const rate_limit_guard_1 = require("../../shared/rate-limit/rate-limit.guard");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const projects_service_1 = require("../projects/projects.service");
const create_test_token_dto_1 = require("./dto/create-test-token.dto");
const rtc_tokens_service_1 = require("./rtc-tokens.service");
const TEST_TOKEN_TTL_SECONDS = 600;
const DEFAULT_TEST_IDENTITY = 'dashboard-test-user';
let DashboardRtcTokensController = class DashboardRtcTokensController {
    constructor(rtcTokensService, projectsService) {
        this.rtcTokensService = rtcTokensService;
        this.projectsService = projectsService;
    }
    async create(user, projectId, roomId, dto) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.rtcTokensService.create(projectId, roomId, {
            participantIdentity: dto.participantIdentity || DEFAULT_TEST_IDENTITY,
            permissions: {
                join: true,
                subscribe: true,
                publish: true,
                publishAudio: true,
                publishVideo: true,
                publishData: false,
            },
            ttlSeconds: TEST_TOKEN_TTL_SECONDS,
        });
    }
};
exports.DashboardRtcTokensController = DashboardRtcTokensController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard),
    (0, rate_limit_decorator_1.RateLimit)(30),
    (0, swagger_1.ApiOperation)({
        summary: 'Mint a short-lived (10 min) test RTC token for this room, for use from the dashboard only',
        description: 'Full join/publish/subscribe grant, fixed 10-minute TTL — not developer-configurable. Intended for smoke-testing a room from the dashboard, never for a real end-user app (see docs/dashboard.md#rtc-tokens).',
    }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Test token minted' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project or room not found, or not owned by the caller' }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Rate limit exceeded' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('roomId', common_1.ParseUUIDPipe)),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, create_test_token_dto_1.CreateTestTokenDto]),
    __metadata("design:returntype", Promise)
], DashboardRtcTokensController.prototype, "create", null);
exports.DashboardRtcTokensController = DashboardRtcTokensController = __decorate([
    (0, swagger_1.ApiTags)('Dashboard — RTC Tokens'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('v1/projects/:projectId/rooms/:roomId/test-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [rtc_tokens_service_1.RtcTokensService,
        projects_service_1.ProjectsService])
], DashboardRtcTokensController);
//# sourceMappingURL=dashboard-rtc-tokens.controller.js.map