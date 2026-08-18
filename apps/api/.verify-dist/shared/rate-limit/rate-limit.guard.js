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
exports.RateLimitGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const app_error_1 = require("../errors/app-error");
const redis_service_1 = require("../redis/redis.service");
const rate_limit_decorator_1 = require("./rate-limit.decorator");
let RateLimitGuard = class RateLimitGuard {
    constructor(reflector, redisService, configService) {
        this.reflector = reflector;
        this.redisService = redisService;
        this.configService = configService;
    }
    async canActivate(context) {
        const limit = this.reflector.get(rate_limit_decorator_1.RATE_LIMIT_KEY, context.getHandler());
        if (!limit) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const windowSeconds = this.configService.get('rateLimit.windowSeconds');
        const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
        const redisKey = `ratelimit:${routeKey}:${request.ip ?? 'unknown'}`;
        const count = await this.redisService.client.incr(redisKey);
        if (count === 1) {
            await this.redisService.client.expire(redisKey, windowSeconds);
        }
        if (count > limit) {
            throw new app_error_1.TooManyRequestsError();
        }
        return true;
    }
};
exports.RateLimitGuard = RateLimitGuard;
exports.RateLimitGuard = RateLimitGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        redis_service_1.RedisService,
        config_1.ConfigService])
], RateLimitGuard);
//# sourceMappingURL=rate-limit.guard.js.map