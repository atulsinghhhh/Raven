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
exports.ConnectionsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../generated/prisma/client");
const prisma_service_1 = require("../../shared/database/prisma.service");
const app_error_1 = require("../../shared/errors/app-error");
const crypto_util_1 = require("../../shared/utils/crypto.util");
const error_classifier_1 = require("./error-classifier");
let ConnectionsService = class ConnectionsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async recordEvent(ctx, dto) {
        const timestamp = dto.timestamp ? new Date(dto.timestamp) : new Date();
        const data = dto.data ?? {};
        const connection = await this.upsertConnection(ctx, dto.connectionId, dto.type, data, timestamp);
        await this.prisma.connectionEvent.create({
            data: {
                connectionId: connection.id,
                type: dto.type,
                data: data,
                timestamp,
            },
        });
        if (dto.type === 'error') {
            await this.recordError(ctx, connection.id, data);
        }
    }
    async upsertConnection(ctx, publicId, type, data, timestamp) {
        const existing = await this.prisma.connection.findUnique({ where: { publicId } });
        const patch = {};
        const str = (key) => (typeof data[key] === 'string' ? data[key] : undefined);
        patch.sdkVersion = str('sdkVersion');
        patch.platform = str('platform');
        patch.browser = str('browser');
        patch.networkType = str('networkType');
        patch.region = str('region');
        patch.iceConnectionState = str('iceConnectionState');
        patch.signalingState = str('signalingState');
        let reconnectDelta = 0;
        switch (type) {
            case 'connection_started':
                patch.state = client_1.ConnectionState.CONNECTING;
                patch.startedAt = timestamp;
                break;
            case 'connected':
                patch.state = client_1.ConnectionState.CONNECTED;
                if (!existing?.connectedAt)
                    patch.connectedAt = timestamp;
                break;
            case 'reconnecting':
                patch.state = client_1.ConnectionState.RECONNECTING;
                reconnectDelta = 1;
                break;
            case 'reconnected':
                patch.state = client_1.ConnectionState.CONNECTED;
                break;
            case 'disconnected':
                patch.state = client_1.ConnectionState.DISCONNECTED;
                patch.disconnectedAt = timestamp;
                patch.disconnectReason = str('reason');
                break;
            case 'connection_failed':
                patch.state = client_1.ConnectionState.FAILED;
                patch.disconnectedAt = timestamp;
                break;
            default:
                break;
        }
        if (type === 'disconnected' || type === 'connection_failed') {
            const start = existing?.connectedAt ?? existing?.startedAt ?? timestamp;
            patch.durationMs = Math.max(0, timestamp.getTime() - new Date(start).getTime());
        }
        const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        if (existing) {
            return this.prisma.connection.update({
                where: { id: existing.id },
                data: { ...cleanPatch, reconnectCount: existing.reconnectCount + reconnectDelta },
            });
        }
        return this.prisma.connection.create({
            data: {
                publicId,
                projectId: ctx.projectId,
                roomId: ctx.roomId,
                roomName: ctx.roomName,
                participantIdentity: ctx.participantId,
                reconnectCount: reconnectDelta,
                ...cleanPatch,
            },
        });
    }
    async recordError(ctx, connectionRowId, data) {
        const str = (key) => (typeof data[key] === 'string' ? data[key] : undefined);
        const classification = (0, error_classifier_1.classifyError)({
            code: str('code'),
            message: str('message'),
            iceConnectionState: str('iceConnectionState'),
            signalingState: str('signalingState'),
            hint: str('hint'),
        });
        await this.prisma.errorEvent.create({
            data: {
                publicId: (0, crypto_util_1.generateId)('err'),
                projectId: ctx.projectId,
                connectionId: connectionRowId,
                roomId: ctx.roomId,
                participantId: ctx.participantId,
                category: classification.category,
                message: (str('message') ?? 'Unknown error').slice(0, 500),
                likelyCause: classification.likelyCause,
                suggestedAction: classification.suggestedAction,
                sdkVersion: str('sdkVersion'),
                platform: str('platform'),
            },
        });
    }
    async listForProject(projectId, query) {
        return this.prisma.connection.findMany({
            where: {
                projectId,
                ...(query.state ? { state: query.state } : {}),
                ...(query.roomId ? { roomId: query.roomId } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: query.limit,
        });
    }
    async getDetail(projectId, publicId) {
        const connection = await this.prisma.connection.findUnique({
            where: { publicId },
            include: {
                events: { orderBy: { timestamp: 'asc' } },
                errors: { orderBy: { timestamp: 'asc' } },
            },
        });
        if (!connection || connection.projectId !== projectId) {
            throw new app_error_1.NotFoundError('Connection');
        }
        return {
            ...connection,
            errors: connection.errors.map((error) => ({ ...error, connectionId: connection.publicId })),
        };
    }
    async findActive(projectId) {
        return this.prisma.connection.findMany({
            where: {
                ...(projectId ? { projectId } : {}),
                state: { in: [client_1.ConnectionState.CONNECTING, client_1.ConnectionState.CONNECTED, client_1.ConnectionState.RECONNECTING] },
            },
            select: { roomId: true, participantIdentity: true, projectId: true },
        });
    }
};
exports.ConnectionsService = ConnectionsService;
exports.ConnectionsService = ConnectionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ConnectionsService);
//# sourceMappingURL=connections.service.js.map