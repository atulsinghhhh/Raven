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
exports.ConnectionRateLimitService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const redis_service_1 = require("../../../shared/redis/redis.service");
let ConnectionRateLimitService = class ConnectionRateLimitService {
    constructor(redisService, configService) {
        this.redisService = redisService;
        this.configService = configService;
    }
    async isAllowed(clientIp) {
        const limit = this.configService.get('signaling.maxConnectionsPerWindow');
        const windowSeconds = this.configService.get('rateLimit.windowSeconds');
        const key = `ratelimit:signaling:connect:${clientIp}`;
        const count = await this.redisService.client.incr(key);
        if (count === 1) {
            await this.redisService.client.expire(key, windowSeconds);
        }
        return count <= limit;
    }
};
exports.ConnectionRateLimitService = ConnectionRateLimitService;
exports.ConnectionRateLimitService = ConnectionRateLimitService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService,
        config_1.ConfigService])
], ConnectionRateLimitService);
//# sourceMappingURL=connection-rate-limit.service.js.map