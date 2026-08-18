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
var TypingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const redis_service_1 = require("../../../shared/redis/redis.service");
const chat_constants_1 = require("../chat.constants");
const chat_events_service_1 = require("../realtime/chat-events.service");
let TypingService = TypingService_1 = class TypingService {
    constructor(redisService, configService, events) {
        this.redisService = redisService;
        this.configService = configService;
        this.events = events;
        this.logger = new common_1.Logger(TypingService_1.name);
    }
    get ttlSeconds() {
        return this.configService.get('chat.typingTtlSeconds');
    }
    async start(projectId, conversationId, conversationPublicId, userId, originConnectionId) {
        const key = chat_constants_1.RedisKeys.typing(projectId, conversationId, userId);
        const indexKey = chat_constants_1.RedisKeys.typingIndex(projectId, conversationId);
        let wasAlreadyTyping = false;
        try {
            wasAlreadyTyping = (await this.redisService.client.exists(key)) === 1;
            await this.redisService.client
                .multi()
                .set(key, '1', 'EX', this.ttlSeconds)
                .zadd(indexKey, Date.now() + this.ttlSeconds * 1000, userId)
                .expire(indexKey, this.ttlSeconds * 4)
                .exec();
        }
        catch (err) {
            this.logger.warn(`typing write failed: ${err.message}`);
            return;
        }
        if (!wasAlreadyTyping) {
            await this.publish(chat_constants_1.ChatServerFrame.TYPING_STARTED, projectId, conversationId, conversationPublicId, userId, originConnectionId);
        }
    }
    async stop(projectId, conversationId, conversationPublicId, userId, originConnectionId) {
        let wasTyping = false;
        try {
            const removed = await this.redisService.client.del(chat_constants_1.RedisKeys.typing(projectId, conversationId, userId));
            wasTyping = removed === 1;
            await this.redisService.client.zrem(chat_constants_1.RedisKeys.typingIndex(projectId, conversationId), userId);
        }
        catch (err) {
            this.logger.warn(`typing clear failed: ${err.message}`);
            return;
        }
        if (wasTyping) {
            await this.publish(chat_constants_1.ChatServerFrame.TYPING_STOPPED, projectId, conversationId, conversationPublicId, userId, originConnectionId);
        }
    }
    async list(projectId, conversationId) {
        const indexKey = chat_constants_1.RedisKeys.typingIndex(projectId, conversationId);
        const now = Date.now();
        try {
            await this.redisService.client.zremrangebyscore(indexKey, '-inf', now);
            return await this.redisService.client.zrangebyscore(indexKey, now, '+inf');
        }
        catch (err) {
            this.logger.warn(`typing read failed: ${err.message}`);
            return [];
        }
    }
    async publish(type, projectId, conversationId, conversationPublicId, userId, originConnectionId) {
        await this.events.publish(projectId, conversationId, { type, conversationId, roomId: conversationPublicId, userId }, originConnectionId);
    }
};
exports.TypingService = TypingService;
exports.TypingService = TypingService = TypingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService,
        config_1.ConfigService,
        chat_events_service_1.ChatEventsService])
], TypingService);
//# sourceMappingURL=typing.service.js.map