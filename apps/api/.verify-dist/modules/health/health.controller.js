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
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const swagger_1 = require("@nestjs/swagger");
const prisma_service_1 = require("../../shared/database/prisma.service");
const redis_service_1 = require("../../shared/redis/redis.service");
const signaling_gateway_1 = require("../signaling/gateway/signaling.gateway");
const dependency_checks_util_1 = require("./dependency-checks.util");
const DEPENDENCY_CHECK_TIMEOUT_MS = 2000;
let HealthController = class HealthController {
    constructor(prisma, redis, signalingGateway, configService) {
        this.prisma = prisma;
        this.redis = redis;
        this.signalingGateway = signalingGateway;
        this.configService = configService;
    }
    async check(res) {
        const [database, redis, livekit, turn] = await Promise.all([
            this.checkDependency(() => this.prisma.ping()),
            this.checkDependency(() => this.redis.ping()),
            this.checkDependency(async () => {
                const ok = await (0, dependency_checks_util_1.checkLiveKitHttp)(this.configService.get('livekit.internalUrl'));
                if (!ok)
                    throw new Error('unreachable');
            }),
            this.checkDependency(async () => {
                const ok = await (0, dependency_checks_util_1.checkStunBinding)(this.configService.get('turn.internalHost'), this.configService.get('turn.port'));
                if (!ok)
                    throw new Error('unreachable');
            }),
        ]);
        const status = database === 'up' && redis === 'up' && livekit === 'up' && turn === 'up' ? 'ok' : 'degraded';
        res.status(status === 'ok' ? 200 : 503).json({
            status,
            dependencies: { database, redis, livekit, turn },
            signaling: this.signalingGateway.getMetrics(),
        });
    }
    async checkDependency(fn) {
        let timer;
        try {
            await Promise.race([
                fn(),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error('timeout')), DEPENDENCY_CHECK_TIMEOUT_MS);
                }),
            ]);
            return 'up';
        }
        catch {
            return 'down';
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Liveness/readiness check — unauthenticated' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'All dependencies reachable',
        schema: {
            example: {
                status: 'ok',
                dependencies: { database: 'up', redis: 'up', livekit: 'up', turn: 'up' },
                signaling: { activeConnections: 2, activeRooms: 1, activeParticipants: 2 },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 503,
        description: 'At least one dependency is unreachable',
        schema: {
            example: { status: 'degraded', dependencies: { database: 'up', redis: 'down', livekit: 'up', turn: 'up' } },
        },
    }),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "check", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('Health'),
    (0, common_1.Controller)('health'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        signaling_gateway_1.SignalingGateway,
        config_1.ConfigService])
], HealthController);
//# sourceMappingURL=health.controller.js.map