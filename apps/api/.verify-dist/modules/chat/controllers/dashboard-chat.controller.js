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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardChatController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const client_1 = require("../../../generated/prisma/client");
const prisma_service_1 = require("../../../shared/database/prisma.service");
const current_user_decorator_1 = require("../../auth/decorators/current-user.decorator");
const jwt_auth_guard_1 = require("../../auth/guards/jwt-auth.guard");
const projects_service_1 = require("../../projects/projects.service");
const chat_gateway_1 = require("../gateway/chat.gateway");
const chat_metrics_service_1 = require("../metrics/chat-metrics.service");
const presence_service_1 = require("../presence/presence.service");
const RANGE_MINUTES = { '15m': 15, '1h': 60, '24h': 1440 };
let DashboardChatController = class DashboardChatController {
    constructor(prisma, projectsService, metrics, presence, gateway) {
        this.prisma = prisma;
        this.projectsService = projectsService;
        this.metrics = metrics;
        this.presence = presence;
        this.gateway = gateway;
    }
    async overview(user, projectId, range = '1h') {
        await this.projectsService.findOneForOwner(projectId, user.id);
        const minutes = RANGE_MINUTES[range] ?? RANGE_MINUTES['1h'];
        const [conversations, messages, activeConnections, messagesSent, messagesFailed, messagesFannedOut, connectionsOpened, connectionsFailed, rateLimited, persistLatencyMs, fanoutLatencyMs, endToEndLatencyMs,] = await Promise.all([
            this.prisma.conversation.count({ where: { projectId, status: client_1.ConversationStatus.ACTIVE } }),
            this.prisma.message.count({
                where: { projectId, deletedAt: null, createdAt: { gte: new Date(Date.now() - minutes * 60_000) } },
            }),
            this.prisma.chatConnection.count({ where: { projectId, state: client_1.ConnectionState.CONNECTED } }),
            this.metrics.readCounter(projectId, 'messages_sent', minutes),
            this.metrics.readCounter(projectId, 'messages_failed', minutes),
            this.metrics.readCounter(projectId, 'messages_fanned_out', minutes),
            this.metrics.readCounter(projectId, 'connections_opened', minutes),
            this.metrics.readCounter(projectId, 'connections_failed', minutes),
            this.metrics.readCounter(projectId, 'rate_limited', minutes),
            this.metrics.readAverageLatency(projectId, 'persist', minutes),
            this.metrics.readAverageLatency(projectId, 'fanout', minutes),
            this.metrics.readAverageLatency(projectId, 'end_to_end', minutes),
        ]);
        return {
            range,
            conversations,
            messagesStored: messages,
            activeConnections,
            messagesSent,
            messagesFailed,
            messagesFannedOut,
            connectionsOpened,
            connectionsFailed,
            rateLimited,
            messagesPerSecond: round2(messagesSent / (minutes * 60)),
            latency: {
                persistMs: persistLatencyMs,
                fanoutMs: fanoutLatencyMs,
                endToEndMs: endToEndLatencyMs,
            },
            gateway: this.gateway.getMetrics(),
        };
    }
    async listConversations(user, projectId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        const conversations = await this.prisma.conversation.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: {
                _count: { select: { messages: true, members: true } },
                messages: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { createdAt: true, senderId: true },
                },
            },
        });
        return conversations.map((conversation) => ({
            id: conversation.publicId,
            name: conversation.name,
            type: conversation.type,
            status: conversation.status,
            roomId: conversation.roomId,
            retentionDays: conversation.retentionDays,
            messageCount: conversation._count.messages,
            memberCount: conversation._count.members,
            lastMessageAt: conversation.messages[0]?.createdAt ?? null,
            lastMessageSenderId: conversation.messages[0]?.senderId ?? null,
            createdAt: conversation.createdAt,
        }));
    }
    async listConnections(user, projectId, state, limit) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        return this.prisma.chatConnection.findMany({
            where: {
                projectId,
                ...(state && state in client_1.ConnectionState ? { state: state } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(limit) || 50, 200),
        });
    }
    async presenceFor(user, projectId, conversationPublicId) {
        await this.projectsService.findOneForOwner(projectId, user.id);
        const conversation = await this.prisma.conversation.findUnique({
            where: { publicId: conversationPublicId },
            select: { id: true, projectId: true },
        });
        if (!conversation || conversation.projectId !== projectId) {
            return [];
        }
        return this.presence.list(projectId, conversation.id);
    }
};
exports.DashboardChatController = DashboardChatController;
__decorate([
    (0, common_1.Get)('overview'),
    (0, swagger_1.ApiOperation)({ summary: 'Chat activity for this project — real counters, never estimates' }),
    (0, swagger_1.ApiQuery)({ name: 'range', required: false, enum: Object.keys(RANGE_MINUTES) }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Project not found, or not owned by the caller' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Query)('range')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], DashboardChatController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('conversations'),
    (0, swagger_1.ApiOperation)({ summary: 'Conversations with message counts and last activity' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DashboardChatController.prototype, "listConversations", null);
__decorate([
    (0, common_1.Get)('connections'),
    (0, swagger_1.ApiOperation)({ summary: 'Chat WebSocket sessions, newest first' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Query)('state')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], DashboardChatController.prototype, "listConnections", null);
__decorate([
    (0, common_1.Get)('conversations/:conversationId/presence'),
    (0, swagger_1.ApiOperation)({ summary: 'Who is present in one conversation right now (read from Redis, not Postgres)' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('projectId', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Param)('conversationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], DashboardChatController.prototype, "presenceFor", null);
exports.DashboardChatController = DashboardChatController = __decorate([
    (0, swagger_1.ApiTags)('Dashboard — Chat'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('v1/projects/:projectId/chat'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        projects_service_1.ProjectsService,
        chat_metrics_service_1.ChatMetricsService,
        presence_service_1.PresenceService,
        chat_gateway_1.ChatGateway])
], DashboardChatController);
function round2(value) {
    return Math.round(value * 100) / 100;
}
//# sourceMappingURL=dashboard-chat.controller.js.map