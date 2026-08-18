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
var ChatEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatEventsService = void 0;
const common_1 = require("@nestjs/common");
const redis_service_1 = require("../../../shared/redis/redis.service");
const chat_constants_1 = require("../chat.constants");
let ChatEventsService = ChatEventsService_1 = class ChatEventsService {
    constructor(redisService) {
        this.redisService = redisService;
        this.logger = new common_1.Logger(ChatEventsService_1.name);
        this.handlers = new Set();
        this.refCounts = new Map();
    }
    onModuleInit() {
        this.subscriber = this.redisService.client.duplicate();
        this.subscriber.on('message', (_channel, payload) => {
            let envelope;
            try {
                envelope = JSON.parse(payload);
            }
            catch {
                this.logger.warn('discarded malformed event payload from Redis');
                return;
            }
            for (const handler of Array.from(this.handlers)) {
                try {
                    handler(envelope);
                }
                catch (err) {
                    this.logger.error(`chat event handler failed: ${err.message}`);
                }
            }
        });
        this.subscriber.on('error', (err) => {
            this.logger.error(`chat event subscriber error: ${err.message}`);
        });
    }
    async onModuleDestroy() {
        this.handlers.clear();
        this.refCounts.clear();
        await this.subscriber?.quit().catch(() => undefined);
    }
    onEvent(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
    async publish(projectId, conversationId, event, originConnectionId) {
        const envelope = {
            event,
            projectId,
            originConnectionId,
            publishedAt: Date.now(),
        };
        try {
            await this.redisService.client.publish(chat_constants_1.RedisKeys.conversationChannel(projectId, conversationId), JSON.stringify(envelope));
        }
        catch (err) {
            this.logger.error(`real-time fan-out failed for conversation ${conversationId}: ${err.message}`);
        }
    }
    async subscribe(projectId, conversationId) {
        const channel = chat_constants_1.RedisKeys.conversationChannel(projectId, conversationId);
        const current = this.refCounts.get(channel) ?? 0;
        this.refCounts.set(channel, current + 1);
        if (current === 0) {
            await this.subscriber.subscribe(channel);
        }
        let released = false;
        return async () => {
            if (released)
                return;
            released = true;
            const next = (this.refCounts.get(channel) ?? 1) - 1;
            if (next <= 0) {
                this.refCounts.delete(channel);
                await this.subscriber.unsubscribe(channel).catch(() => undefined);
            }
            else {
                this.refCounts.set(channel, next);
            }
        };
    }
    getSubscribedChannelCount() {
        return this.refCounts.size;
    }
};
exports.ChatEventsService = ChatEventsService;
exports.ChatEventsService = ChatEventsService = ChatEventsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService])
], ChatEventsService);
//# sourceMappingURL=chat-events.service.js.map