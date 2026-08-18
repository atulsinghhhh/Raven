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
exports.RoomsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../generated/prisma/client");
const prisma_service_1 = require("../../shared/database/prisma.service");
const app_error_1 = require("../../shared/errors/app-error");
const livekit_room_service_1 = require("./livekit-room.service");
let RoomsService = class RoomsService {
    constructor(prisma, liveKitRoomService) {
        this.prisma = prisma;
        this.liveKitRoomService = liveKitRoomService;
    }
    async create(projectId, dto) {
        const existing = await this.prisma.room.findUnique({
            where: { projectId_name: { projectId, name: dto.name } },
        });
        if (existing) {
            throw new app_error_1.ConflictError(`A room named "${dto.name}" already exists in this project`);
        }
        return this.prisma.room.create({ data: { projectId, name: dto.name } });
    }
    findAllForProject(projectId) {
        return this.prisma.room.findMany({
            where: { projectId, status: client_1.RoomStatus.ACTIVE },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOneForProject(id, projectId) {
        const room = await this.prisma.room.findUnique({ where: { id } });
        if (!room || room.projectId !== projectId) {
            throw new app_error_1.NotFoundError('Room');
        }
        return room;
    }
    async close(id, projectId) {
        await this.findOneForProject(id, projectId);
        await this.prisma.room.update({
            where: { id },
            data: { status: client_1.RoomStatus.CLOSED },
        });
    }
    async findAllForProjectWithLiveState(projectId) {
        const rooms = await this.findAllForProject(projectId);
        const liveCounts = await this.liveKitRoomService.listLiveParticipantCounts(rooms.map((r) => r.name));
        return rooms.map((room) => ({
            ...room,
            liveParticipantCount: liveCounts ? liveCounts.get(room.name) ?? 0 : null,
        }));
    }
    async findOneForProjectWithLiveState(id, projectId) {
        const room = await this.findOneForProject(id, projectId);
        const liveParticipants = await this.liveKitRoomService.listLiveParticipants(room.name);
        return {
            ...room,
            liveParticipantCount: liveParticipants ? liveParticipants.length : null,
            liveParticipants: liveParticipants ?? null,
        };
    }
};
exports.RoomsService = RoomsService;
exports.RoomsService = RoomsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        livekit_room_service_1.LiveKitRoomService])
], RoomsService);
//# sourceMappingURL=rooms.service.js.map