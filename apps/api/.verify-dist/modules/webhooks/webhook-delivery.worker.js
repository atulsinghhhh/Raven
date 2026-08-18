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
var WebhookDeliveryWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookDeliveryWorker = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("../../generated/prisma/client");
const prisma_service_1 = require("../../shared/database/prisma.service");
const redis_service_1 = require("../../shared/redis/redis.service");
const chat_constants_1 = require("../chat/chat.constants");
const webhook_signature_util_1 = require("./webhook-signature.util");
const LOCK_TTL_SECONDS = 30;
const MAX_ERROR_LENGTH = 500;
let WebhookDeliveryWorker = WebhookDeliveryWorker_1 = class WebhookDeliveryWorker {
    constructor(prisma, redisService, configService) {
        this.prisma = prisma;
        this.redisService = redisService;
        this.configService = configService;
        this.logger = new common_1.Logger(WebhookDeliveryWorker_1.name);
        this.draining = false;
        this.instanceId = `wh_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    }
    onModuleInit() {
        const intervalMs = this.configService.get('webhooks.pollIntervalMs');
        this.timer = setInterval(() => void this.tick(), intervalMs);
        this.timer.unref?.();
    }
    onModuleDestroy() {
        if (this.timer) {
            clearInterval(this.timer);
        }
    }
    async tick() {
        if (this.draining) {
            return 0;
        }
        this.draining = true;
        let holdsLock = false;
        try {
            holdsLock = await this.acquireLock();
            if (!holdsLock) {
                return 0;
            }
            return await this.drainBatch();
        }
        catch (err) {
            this.logger.error(`webhook worker pass failed: ${err.message}`);
            return 0;
        }
        finally {
            if (holdsLock) {
                await this.releaseLock();
            }
            this.draining = false;
        }
    }
    async acquireLock() {
        try {
            const acquired = await this.redisService.client.set(chat_constants_1.RedisKeys.webhookWorkerLock, this.instanceId, 'EX', LOCK_TTL_SECONDS, 'NX');
            return acquired === 'OK';
        }
        catch (err) {
            this.logger.warn(`could not acquire webhook lock: ${err.message}`);
            return false;
        }
    }
    async releaseLock() {
        try {
            const current = await this.redisService.client.get(chat_constants_1.RedisKeys.webhookWorkerLock);
            if (current === this.instanceId) {
                await this.redisService.client.del(chat_constants_1.RedisKeys.webhookWorkerLock);
            }
        }
        catch (err) {
            this.logger.warn(`could not release webhook lock: ${err.message}`);
        }
    }
    async drainBatch() {
        const batchSize = this.configService.get('webhooks.batchSize');
        const due = await this.prisma.webhookDelivery.findMany({
            where: {
                status: client_1.WebhookDeliveryStatus.PENDING,
                nextAttemptAt: { lte: new Date() },
                endpoint: { status: client_1.WebhookEndpointStatus.ACTIVE },
            },
            include: { event: true, endpoint: true },
            orderBy: { nextAttemptAt: 'asc' },
            take: batchSize,
        });
        for (const delivery of due) {
            await this.attempt(delivery);
        }
        return due.length;
    }
    async attempt(delivery) {
        const maxAttempts = this.configService.get('webhooks.maxAttempts');
        const timeoutMs = this.configService.get('webhooks.timeoutMs');
        const body = JSON.stringify({
            id: delivery.event.publicId,
            type: delivery.event.type,
            projectId: delivery.event.projectId,
            createdAt: delivery.event.createdAt.toISOString(),
            data: delivery.event.payload,
        });
        const timestamp = Math.floor(Date.now() / 1000);
        const attempts = delivery.attempts + 1;
        let responseStatus;
        let failure;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(delivery.endpoint.url, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'user-agent': 'Raven-Webhooks/1.0',
                        [webhook_signature_util_1.WEBHOOK_SIGNATURE_HEADER]: (0, webhook_signature_util_1.signWebhookPayload)(body, delivery.endpoint.signingSecret, timestamp),
                        [webhook_signature_util_1.WEBHOOK_EVENT_ID_HEADER]: delivery.event.publicId,
                        [webhook_signature_util_1.WEBHOOK_EVENT_TYPE_HEADER]: delivery.event.type,
                    },
                    body,
                    signal: controller.signal,
                });
                responseStatus = response.status;
                if (!response.ok) {
                    failure = `endpoint responded ${response.status}`;
                }
            }
            finally {
                clearTimeout(timeout);
            }
        }
        catch (err) {
            failure = err instanceof Error ? err.message : String(err);
        }
        if (!failure) {
            await this.prisma.$transaction([
                this.prisma.webhookDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: client_1.WebhookDeliveryStatus.DELIVERED,
                        attempts,
                        responseStatus,
                        deliveredAt: new Date(),
                        lastError: null,
                    },
                }),
                this.prisma.webhookEndpoint.update({
                    where: { id: delivery.endpoint.id },
                    data: { consecutiveFailures: 0, lastDeliveryAt: new Date() },
                }),
            ]);
            return;
        }
        const exhausted = attempts >= maxAttempts;
        await this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                status: exhausted ? client_1.WebhookDeliveryStatus.FAILED : client_1.WebhookDeliveryStatus.PENDING,
                attempts,
                responseStatus,
                lastError: failure.slice(0, MAX_ERROR_LENGTH),
                nextAttemptAt: exhausted ? undefined : new Date(Date.now() + this.backoffMs(attempts)),
            },
        });
        const consecutiveFailures = delivery.endpoint.consecutiveFailures + 1;
        const disableAfter = this.configService.get('webhooks.disableAfterConsecutiveFailures');
        await this.prisma.webhookEndpoint.update({
            where: { id: delivery.endpoint.id },
            data: {
                consecutiveFailures,
                lastDeliveryAt: new Date(),
                ...(consecutiveFailures >= disableAfter ? { status: client_1.WebhookEndpointStatus.DISABLED } : {}),
            },
        });
        this.logger.warn(`webhook delivery ${delivery.id} attempt ${attempts}/${maxAttempts} failed: ${failure.slice(0, 120)}`);
    }
    backoffMs(attempt) {
        const base = this.configService.get('webhooks.backoffBaseMs');
        return base * Math.pow(2, attempt - 1);
    }
};
exports.WebhookDeliveryWorker = WebhookDeliveryWorker;
exports.WebhookDeliveryWorker = WebhookDeliveryWorker = WebhookDeliveryWorker_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService])
], WebhookDeliveryWorker);
//# sourceMappingURL=webhook-delivery.worker.js.map