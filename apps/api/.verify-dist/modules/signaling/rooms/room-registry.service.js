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
var RoomRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomRegistryService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const signaling_error_1 = require("../signaling-error");
const signaling_constants_1 = require("../signaling.constants");
let RoomRegistryService = RoomRegistryService_1 = class RoomRegistryService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(RoomRegistryService_1.name);
        this.rooms = new Map();
    }
    join(session) {
        const maxParticipants = this.configService.get('signaling.maxParticipantsPerRoom');
        let room = this.rooms.get(session.roomId);
        if (!room) {
            room = new Map();
            this.rooms.set(session.roomId, room);
        }
        const replaced = room.get(session.participantId) ?? null;
        if (!replaced && room.size >= maxParticipants) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.ROOM_FULL, `Room has reached its maximum of ${maxParticipants} participants`);
        }
        const existingParticipants = Array.from(room.values()).filter((p) => p.participantId !== session.participantId);
        room.set(session.participantId, session);
        this.logger.log(`participant ${session.participantId} joined room ${session.roomId} (${room.size} total)`);
        return { replaced, existingParticipants };
    }
    leave(roomId, participantId) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return null;
        }
        const session = room.get(participantId) ?? null;
        if (session) {
            room.delete(participantId);
            this.logger.log(`participant ${participantId} left room ${roomId} (${room.size} remain)`);
        }
        if (room.size === 0) {
            this.rooms.delete(roomId);
        }
        return session;
    }
    get(roomId, participantId) {
        return this.rooms.get(roomId)?.get(participantId);
    }
    listParticipants(roomId, excludingParticipantId) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return [];
        }
        return Array.from(room.values()).filter((p) => p.participantId !== excludingParticipantId);
    }
    getMetrics() {
        let activeParticipants = 0;
        for (const room of this.rooms.values()) {
            activeParticipants += room.size;
        }
        return { activeRooms: this.rooms.size, activeParticipants };
    }
};
exports.RoomRegistryService = RoomRegistryService;
exports.RoomRegistryService = RoomRegistryService = RoomRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RoomRegistryService);
//# sourceMappingURL=room-registry.service.js.map