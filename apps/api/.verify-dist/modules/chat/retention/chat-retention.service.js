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
var ChatRetentionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatRetentionService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const redis_service_1 = require("../../../shared/redis/redis.service");
const chat_constants_1 = require("../chat.constants");
const LOCK_TTL_SECONDS = 300;
const DELETE_BATCH_SIZE = 1000;
let ChatRetentionService = ChatRetentionService_1 = class ChatRetentionService {
    constructor(prisma, redisService, configService) {
        this.prisma = prisma;
        this.redisService = redisService;
        this.configService = configService;
        this.logger = new common_1.Logger(ChatRetentionService_1.name);
    }
    onModuleInit() {
        const intervalMs = this.configService.get('chat.retentionSweepIntervalMs');
        this.timer = setInterval(() => void this.sweep(), intervalMs);
        this.timer.unref?.();
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async sweep() {
        if (!(await this.acquireLock())) {
            return 0;
        }
        let removed = 0;
        try {
            removed += await this.sweepPerConversationOverrides();
            removed += await this.sweepProjectDefault();
        }
        catch (err) {
            this.logger.error(`chat retention sweep failed: ${err.message}`);
        }
        if (removed > 0) {
            this.logger.log(`chat retention removed ${removed} expired messages`);
        }
        return removed;
    }
    async sweepPerConversationOverrides() {
        const conversations = await this.prisma.conversation.findMany({
            where: { retentionDays: { not: null } },
            select: { id: true, retentionDays: true },
        });
        let removed = 0;
        for (const conversation of conversations) {
            const cutoff = daysAgo(conversation.retentionDays);
            removed += await this.deleteOlderThan({ conversationId: conversation.id, createdAt: { lt: cutoff } });
        }
        return removed;
    }
    async sweepProjectDefault() {
        const retentionDays = this.configService.get('chat.retentionDays');
        if (!retentionDays || retentionDays <= 0) {
            return 0;
        }
        const cutoff = daysAgo(retentionDays);
        return this.deleteOlderThan({
            createdAt: { lt: cutoff },
            conversation: { retentionDays: null },
        });
    }
    async deleteOlderThan(where) {
        let total = 0;
        for (;;) {
            const batch = await this.prisma.message.findMany({
                where,
                select: { id: true },
                take: DELETE_BATCH_SIZE,
            });
            if (batch.length === 0) {
                return total;
            }
            const result = await this.prisma.message.deleteMany({
                where: { id: { in: batch.map((row) => row.id) } },
            });
            total += result.count;
            if (batch.length < DELETE_BATCH_SIZE) {
                return total;
            }
        }
    }
    async acquireLock() {
        try {
            const acquired = await this.redisService.client.set(chat_constants_1.RedisKeys.chatRetentionLock, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
            return acquired === 'OK';
        }
        catch {
            return false;
        }
    }
};
exports.ChatRetentionService = ChatRetentionService;
exports.ChatRetentionService = ChatRetentionService = ChatRetentionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService])
], ChatRetentionService);
function daysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
//# sourceMappingURL=chat-retention.service.js.map