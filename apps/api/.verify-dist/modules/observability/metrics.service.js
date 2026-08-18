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
exports.MetricsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../generated/prisma/client");
const prisma_service_1 = require("../../shared/database/prisma.service");
const RANGE_MS = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
};
let MetricsService = class MetricsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getOverview(projectId, range = '1h') {
        const windowMs = RANGE_MS[range] ?? RANGE_MS['1h'];
        const since = new Date(Date.now() - windowMs);
        const [active, windowed, errorCount] = await Promise.all([
            this.prisma.connection.findMany({
                where: {
                    projectId,
                    state: { in: [client_1.ConnectionState.CONNECTING, client_1.ConnectionState.CONNECTED, client_1.ConnectionState.RECONNECTING] },
                },
                select: { roomId: true, participantIdentity: true },
            }),
            this.prisma.connection.findMany({
                where: { projectId, createdAt: { gte: since } },
                select: { connectedAt: true, reconnectCount: true, durationMs: true },
            }),
            this.prisma.errorEvent.count({ where: { projectId, timestamp: { gte: since } } }),
        ]);
        const activeRooms = new Set(active.map((c) => c.roomId).filter((id) => Boolean(id))).size;
        const activeParticipants = new Set(active.map((c) => c.participantIdentity)).size;
        const total = windowed.length;
        const connectedCount = windowed.filter((c) => c.connectedAt).length;
        const reconnectedCount = windowed.filter((c) => c.reconnectCount > 0).length;
        const durations = windowed.map((c) => c.durationMs).filter((d) => typeof d === 'number');
        return {
            range,
            activeRooms,
            activeParticipants,
            connections: total,
            connectionSuccessRate: total > 0 ? round1((connectedCount / total) * 100) : null,
            reconnectionRate: total > 0 ? round1((reconnectedCount / total) * 100) : null,
            averageConnectionDurationMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
            errors: errorCount,
        };
    }
};
exports.MetricsService = MetricsService;
exports.MetricsService = MetricsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MetricsService);
function round1(n) {
    return Math.round(n * 10) / 10;
}
//# sourceMappingURL=metrics.service.js.map