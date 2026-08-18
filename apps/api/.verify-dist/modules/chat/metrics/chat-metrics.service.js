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
var ChatMetricsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMetricsService = void 0;
const common_1 = require("@nestjs/common");
const redis_service_1 = require("../../../shared/redis/redis.service");
const chat_constants_1 = require("../chat.constants");
const BUCKET_SECONDS = 60;
const BUCKET_TTL_SECONDS = 2 * 60 * 60;
let ChatMetricsService = ChatMetricsService_1 = class ChatMetricsService {
    constructor(redisService) {
        this.redisService = redisService;
        this.logger = new common_1.Logger(ChatMetricsService_1.name);
    }
    increment(projectId, counter, by = 1) {
        void this.write(projectId, counter, by);
    }
    recordLatency(projectId, stage, ms) {
        if (!Number.isFinite(ms) || ms < 0) {
            return;
        }
        void this.write(projectId, `latency_${stage}_sum`, Math.round(ms));
        void this.write(projectId, `latency_${stage}_count`, 1);
    }
    async readCounter(projectId, metric, minutes) {
        const keys = this.recentBuckets(minutes).map((bucket) => chat_constants_1.RedisKeys.metricCounter(projectId, metric, bucket));
        if (keys.length === 0)
            return 0;
        try {
            const values = await this.redisService.client.mget(...keys);
            return values.reduce((total, value) => total + (value ? Number(value) : 0), 0);
        }
        catch (err) {
            this.logger.warn(`chat metric read failed: ${err.message}`);
            return 0;
        }
    }
    async readAverageLatency(projectId, stage, minutes) {
        const [sum, count] = await Promise.all([
            this.readCounter(projectId, `latency_${stage}_sum`, minutes),
            this.readCounter(projectId, `latency_${stage}_count`, minutes),
        ]);
        return count > 0 ? Math.round(sum / count) : null;
    }
    async write(projectId, metric, by) {
        const key = chat_constants_1.RedisKeys.metricCounter(projectId, metric, currentBucket());
        try {
            await this.redisService.client.incrby(key, by);
            await this.redisService.client.expire(key, BUCKET_TTL_SECONDS);
        }
        catch (err) {
            this.logger.warn(`chat metric write failed (${metric}): ${err.message}`);
        }
    }
    recentBuckets(minutes) {
        const now = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
        const capped = Math.min(minutes, BUCKET_TTL_SECONDS / BUCKET_SECONDS);
        return Array.from({ length: capped }, (_unused, i) => String(now - i));
    }
};
exports.ChatMetricsService = ChatMetricsService;
exports.ChatMetricsService = ChatMetricsService = ChatMetricsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService])
], ChatMetricsService);
function currentBucket() {
    return String(Math.floor(Date.now() / 1000 / BUCKET_SECONDS));
}
//# sourceMappingURL=chat-metrics.service.js.map