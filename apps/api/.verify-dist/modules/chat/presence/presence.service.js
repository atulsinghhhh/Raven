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
var PresenceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresenceService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const redis_service_1 = require("../../../shared/redis/redis.service");
const chat_constants_1 = require("../chat.constants");
const chat_error_1 = require("../chat-error");
const chat_events_service_1 = require("../realtime/chat-events.service");
let PresenceService = PresenceService_1 = class PresenceService {
    constructor(redisService, configService, events) {
        this.redisService = redisService;
        this.configService = configService;
        this.events = events;
        this.logger = new common_1.Logger(PresenceService_1.name);
    }
    get ttlSeconds() {
        return this.configService.get('chat.presenceTtlSeconds');
    }
    async set(projectId, conversationId, conversationPublicId, userId, status) {
        const key = chat_constants_1.RedisKeys.presence(projectId, conversationId, userId);
        const indexKey = chat_constants_1.RedisKeys.presenceIndex(projectId, conversationId);
        const expiresAt = Date.now() + this.ttlSeconds * 1000;
        let previous = null;
        try {
            previous = await this.redisService.client.get(key);
            await this.redisService.client
                .multi()
                .set(key, status, 'EX', this.ttlSeconds)
                .zadd(indexKey, expiresAt, userId)
                .expire(indexKey, this.ttlSeconds * 4)
                .exec();
        }
        catch (err) {
            this.logger.warn(`presence write failed: ${err.message}`);
            return;
        }
        if (previous !== status) {
            await this.publish(projectId, conversationId, conversationPublicId, userId, status);
        }
    }
    async clear(projectId, conversationId, conversationPublicId, userId) {
        try {
            await this.redisService.client
                .multi()
                .del(chat_constants_1.RedisKeys.presence(projectId, conversationId, userId))
                .zrem(chat_constants_1.RedisKeys.presenceIndex(projectId, conversationId), userId)
                .exec();
        }
        catch (err) {
            this.logger.warn(`presence clear failed: ${err.message}`);
            return;
        }
        await this.publish(projectId, conversationId, conversationPublicId, userId, chat_constants_1.PresenceStatus.OFFLINE);
    }
    async list(projectId, conversationId) {
        const indexKey = chat_constants_1.RedisKeys.presenceIndex(projectId, conversationId);
        const now = Date.now();
        try {
            await this.redisService.client.zremrangebyscore(indexKey, '-inf', now);
            const userIds = await this.redisService.client.zrangebyscore(indexKey, now, '+inf');
            if (userIds.length === 0) {
                return [];
            }
            const statuses = await this.redisService.client.mget(...userIds.map((userId) => chat_constants_1.RedisKeys.presence(projectId, conversationId, userId)));
            return userIds
                .map((userId, index) => ({ userId, raw: statuses[index] }))
                .filter((entry) => entry.raw !== null)
                .map(({ userId, raw }) => ({ userId, status: raw }));
        }
        catch (err) {
            this.logger.warn(`presence read failed: ${err.message}`);
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INTERNAL_ERROR, 'Presence is temporarily unavailable');
        }
    }
    async publish(projectId, conversationId, conversationPublicId, userId, status) {
        await this.events.publish(projectId, conversationId, {
            type: chat_constants_1.ChatServerFrame.PRESENCE,
            conversationId,
            roomId: conversationPublicId,
            userId,
            status,
            at: new Date().toISOString(),
        });
    }
};
exports.PresenceService = PresenceService;
exports.PresenceService = PresenceService = PresenceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService,
        config_1.ConfigService,
        chat_events_service_1.ChatEventsService])
], PresenceService);
//# sourceMappingURL=presence.service.js.map