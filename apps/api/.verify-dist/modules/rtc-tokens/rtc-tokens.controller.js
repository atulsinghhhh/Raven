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
exports.RtcTokensController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const rate_limit_decorator_1 = require("../../shared/rate-limit/rate-limit.decorator");
const rate_limit_guard_1 = require("../../shared/rate-limit/rate-limit.guard");
const current_project_id_decorator_1 = require("../api-keys/decorators/current-project-id.decorator");
const api_key_auth_guard_1 = require("../api-keys/guards/api-key-auth.guard");
const create_rtc_token_dto_1 = require("./dto/create-rtc-token.dto");
const rtc_tokens_service_1 = require("./rtc-tokens.service");
let RtcTokensController = class RtcTokensController {
    constructor(rtcTokensService) {
        this.rtcTokensService = rtcTokensService;
    }
    create(projectId, roomId, dto) {
        return this.rtcTokensService.create(projectId, roomId, dto);
    }
};
exports.RtcTokensController = RtcTokensController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard),
    (0, rate_limit_decorator_1.RateLimit)(60),
    (0, swagger_1.ApiOperation)({
        summary: 'Mint a short-lived RTC access token for a participant to join this room',
        description: 'Every token expires (ttlSeconds, max 6 hours) — there is no way to request a permanent token. Permissions are translated into a LiveKit access token grant; see docs/control-plane.md#rtc-tokens-ravens-permissions--livekits-grant. Rate limited to 60 requests/window/IP.',
    }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        description: 'Token minted',
        schema: {
            example: {
                id: '2b45e0e5-97f2-466d-b783-a09fed7f6505',
                token: 'eyJhbGciOiJIUzI1NiJ9...',
                livekitUrl: 'ws://localhost:7880',
                roomId: '8d86361a-7c01-4969-98cb-d0748360b803',
                roomName: 'support-room',
                participantIdentity: 'alice',
                permissions: {
                    join: true,
                    subscribe: true,
                    publish: true,
                    publishAudio: true,
                    publishVideo: true,
                    publishData: true,
                },
                iceServers: [
                    { urls: 'stun:localhost:3478' },
                    { urls: 'turn:localhost:3478?transport=udp', username: '1786980869:alice', credential: 'base64-hmac...' },
                    { urls: 'turn:localhost:3478?transport=tcp', username: '1786980869:alice', credential: 'base64-hmac...' },
                    { urls: 'turns:localhost:5349?transport=tcp', username: '1786980869:alice', credential: 'base64-hmac...' },
                ],
                expiresAt: '2026-08-17T15:19:49.233Z',
                createdAt: '2026-08-17T15:09:49.239Z',
            },
        },
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Room doesn't exist, or belongs to a different project" }),
    (0, swagger_1.ApiTooManyRequestsResponse)({ description: 'Rate limit exceeded' }),
    __param(0, (0, current_project_id_decorator_1.CurrentProjectId)()),
    __param(1, (0, common_1.Param)('roomId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, create_rtc_token_dto_1.CreateRtcTokenDto]),
    __metadata("design:returntype", void 0)
], RtcTokensController.prototype, "create", null);
exports.RtcTokensController = RtcTokensController = __decorate([
    (0, swagger_1.ApiTags)('RTC Tokens'),
    (0, swagger_1.ApiBearerAuth)('apiKey'),
    (0, common_1.Controller)('v1/rooms/:roomId/rtc-tokens'),
    (0, common_1.UseGuards)(api_key_auth_guard_1.ApiKeyAuthGuard),
    __metadata("design:paramtypes", [rtc_tokens_service_1.RtcTokensService])
], RtcTokensController);
//# sourceMappingURL=rtc-tokens.controller.js.map