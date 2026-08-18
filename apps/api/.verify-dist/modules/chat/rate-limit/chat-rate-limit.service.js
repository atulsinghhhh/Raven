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
var ChatRateLimitService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatRateLimitService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const redis_service_1 = require("../../../shared/redis/redis.service");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const SCOPE_CONFIG = {
    send: { limitKey: 'chat.sendRateLimit', windowSeconds: 10, label: 'Sending messages' },
    reaction: { limitKey: 'chat.reactionRateLimit', windowSeconds: 10, label: 'Reacting' },
    typing: { limitKey: 'chat.typingRateLimit', windowSeconds: 10, label: 'Typing updates' },
    subscribe: { limitKey: 'chat.subscribeRateLimit', windowSeconds: 60, label: 'Room subscriptions' },
    connect: { limitKey: 'chat.connectionRateLimit', windowSeconds: 60, label: 'Connection attempts' },
};
let ChatRateLimitService = ChatRateLimitService_1 = class ChatRateLimitService {
    constructor(redisService, configService) {
        this.redisService = redisService;
        this.configService = configService;
        this.logger = new common_1.Logger(ChatRateLimitService_1.name);
    }
    async consume(scope, projectId, subject) {
        const { limitKey, windowSeconds, label } = SCOPE_CONFIG[scope];
        const limit = this.configService.get(limitKey);
        const key = chat_constants_1.RedisKeys.rateLimit(scope, projectId, subject);
        let count;
        try {
            count = await this.redisService.client.incr(key);
            if (count === 1) {
                await this.redisService.client.expire(key, windowSeconds);
            }
        }
        catch (err) {
            this.logger.error(`rate limiter unavailable, allowing request: ${err.message}`);
            return;
        }
        if (count > limit) {
            const ttl = await this.redisService.client.ttl(key).catch(() => windowSeconds);
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.RATE_LIMITED, `${label} is limited to ${limit} per ${windowSeconds}s — slow down`, ttl > 0 ? ttl : windowSeconds);
        }
    }
};
exports.ChatRateLimitService = ChatRateLimitService;
exports.ChatRateLimitService = ChatRateLimitService = ChatRateLimitService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService,
        config_1.ConfigService])
], ChatRateLimitService);
//# sourceMappingURL=chat-rate-limit.service.js.map