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
var LiveKitRoomService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveKitRoomService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const livekit_server_sdk_1 = require("livekit-server-sdk");
let LiveKitRoomService = LiveKitRoomService_1 = class LiveKitRoomService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(LiveKitRoomService_1.name);
        this.client = new livekit_server_sdk_1.RoomServiceClient(this.configService.get('livekit.internalUrl'), this.configService.get('livekit.apiKey'), this.configService.get('livekit.apiSecret'));
    }
    async listLiveParticipantCounts(roomNames) {
        if (roomNames.length === 0)
            return new Map();
        try {
            const rooms = await this.client.listRooms(roomNames);
            return new Map(rooms.map((room) => [room.name, room.numParticipants]));
        }
        catch (error) {
            this.logger.warn(`could not reach LiveKit to list live rooms: ${error.message}`);
            return undefined;
        }
    }
    async listLiveParticipants(roomName) {
        try {
            const participants = await this.client.listParticipants(roomName);
            return participants.map((p) => ({
                identity: p.identity,
                joinedAt: new Date(Number(p.joinedAtMs)),
                tracks: p.tracks.map((t) => ({
                    sid: t.sid,
                    kind: trackKind(t.type),
                    name: t.name,
                    muted: t.muted,
                })),
            }));
        }
        catch (error) {
            this.logger.warn(`could not reach LiveKit to list participants for "${roomName}": ${error.message}`);
            return undefined;
        }
    }
};
exports.LiveKitRoomService = LiveKitRoomService;
exports.LiveKitRoomService = LiveKitRoomService = LiveKitRoomService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], LiveKitRoomService);
function trackKind(type) {
    if (type === 0)
        return 'audio';
    if (type === 1)
        return 'video';
    return 'unknown';
}
//# sourceMappingURL=livekit-room.service.js.map