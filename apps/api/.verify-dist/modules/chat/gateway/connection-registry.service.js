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
var ConnectionRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionRegistryService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("../../../generated/prisma/client");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const redis_service_1 = require("../../../shared/redis/redis.service");
const crypto_1 = require("crypto");
const chat_constants_1 = require("../chat.constants");
let ConnectionRegistryService = ConnectionRegistryService_1 = class ConnectionRegistryService {
    constructor(prisma, redisService, configService) {
        this.prisma = prisma;
        this.redisService = redisService;
        this.configService = configService;
        this.logger = new common_1.Logger(ConnectionRegistryService_1.name);
        this.gatewayId = `gw_${process.pid.toString(36)}_${(0, crypto_1.randomBytes)(3).toString('hex')}`;
    }
    get ttlSeconds() {
        return this.configService.get('chat.presenceTtlSeconds');
    }
    async register(input) {
        await this.touch(input.connectionId, input.projectId, input.userId);
        try {
            const row = await this.prisma.chatConnection.create({
                data: {
                    publicId: input.connectionId,
                    projectId: input.projectId,
                    userId: input.userId,
                    gatewayId: this.gatewayId,
                    state: client_1.ConnectionState.CONNECTED,
                    sdkVersion: input.sdkVersion,
                    platform: input.platform,
                    connectedAt: new Date(),
                },
                select: { id: true },
            });
            return row.id;
        }
        catch (err) {
            this.logger.error(`could not record chat connection: ${err.message}`);
            return undefined;
        }
    }
    async touch(connectionId, projectId, userId) {
        try {
            await this.redisService.client
                .multi()
                .hset(chat_constants_1.RedisKeys.connection(connectionId), {
                gatewayId: this.gatewayId,
                projectId,
                userId,
            })
                .expire(chat_constants_1.RedisKeys.connection(connectionId), this.ttlSeconds)
                .sadd(chat_constants_1.RedisKeys.userConnections(projectId, userId), connectionId)
                .expire(chat_constants_1.RedisKeys.userConnections(projectId, userId), this.ttlSeconds * 4)
                .exec();
        }
        catch (err) {
            this.logger.warn(`connection registry refresh failed: ${err.message}`);
        }
    }
    async unregister(input) {
        try {
            await this.redisService.client
                .multi()
                .del(chat_constants_1.RedisKeys.connection(input.connectionId))
                .srem(chat_constants_1.RedisKeys.userConnections(input.projectId, input.userId), input.connectionId)
                .exec();
        }
        catch (err) {
            this.logger.warn(`connection registry cleanup failed: ${err.message}`);
        }
        if (!input.connectionRowId) {
            return;
        }
        try {
            const now = new Date();
            await this.prisma.chatConnection.update({
                where: { id: input.connectionRowId },
                data: {
                    state: client_1.ConnectionState.DISCONNECTED,
                    disconnectReason: input.reason,
                    disconnectedAt: now,
                    durationMs: now.getTime() - input.connectedAt.getTime(),
                    messagesSent: input.messagesSent,
                },
            });
        }
        catch (err) {
            this.logger.warn(`could not close chat connection row: ${err.message}`);
        }
    }
    async countUserConnections(projectId, userId) {
        try {
            return await this.redisService.client.scard(chat_constants_1.RedisKeys.userConnections(projectId, userId));
        }
        catch {
            return 0;
        }
    }
};
exports.ConnectionRegistryService = ConnectionRegistryService;
exports.ConnectionRegistryService = ConnectionRegistryService = ConnectionRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService])
], ConnectionRegistryService);
//# sourceMappingURL=connection-registry.service.js.map