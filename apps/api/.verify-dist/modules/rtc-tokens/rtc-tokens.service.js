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
exports.RtcTokensService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const livekit_server_sdk_1 = require("livekit-server-sdk");
const prisma_service_1 = require("../../shared/database/prisma.service");
const rooms_service_1 = require("../rooms/rooms.service");
const rtc_token_grant_mapper_1 = require("./rtc-token-grant.mapper");
const turn_credential_util_1 = require("./turn-credential.util");
let RtcTokensService = class RtcTokensService {
    constructor(prisma, roomsService, configService) {
        this.prisma = prisma;
        this.roomsService = roomsService;
        this.configService = configService;
    }
    async create(projectId, roomId, dto) {
        const room = await this.roomsService.findOneForProject(roomId, projectId);
        const ttlSeconds = dto.ttlSeconds ?? this.configService.get('rtcToken.defaultTtlSeconds');
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        const participant = await this.prisma.participant.upsert({
            where: { roomId_identity: { roomId, identity: dto.participantIdentity } },
            create: { roomId, identity: dto.participantIdentity, metadata: dto.metadata },
            update: { metadata: dto.metadata },
        });
        const rtcToken = await this.prisma.rtcToken.create({
            data: {
                projectId,
                roomId,
                participantId: participant.id,
                permissions: dto.permissions,
                expiresAt,
            },
        });
        const accessToken = new livekit_server_sdk_1.AccessToken(this.configService.get('livekit.apiKey'), this.configService.get('livekit.apiSecret'), {
            identity: dto.participantIdentity,
            ttl: ttlSeconds,
            metadata: dto.metadata,
            attributes: { ravenProjectId: projectId, ravenRoomId: room.id },
        });
        accessToken.addGrant((0, rtc_token_grant_mapper_1.toLiveKitGrant)(room.name, dto.permissions));
        const iceServers = (0, turn_credential_util_1.buildIceServers)({
            turnHost: this.configService.get('turn.host'),
            turnPort: this.configService.get('turn.port'),
            turnTlsPort: this.configService.get('turn.tlsPort'),
            turnSecret: this.configService.get('turn.secret'),
            participantIdentity: dto.participantIdentity,
            ttlSeconds,
        });
        return {
            id: rtcToken.id,
            token: await accessToken.toJwt(),
            livekitUrl: this.configService.get('livekit.url'),
            roomId: room.id,
            roomName: room.name,
            participantIdentity: dto.participantIdentity,
            permissions: dto.permissions,
            iceServers,
            telemetryUrl: this.configService.get('publicUrl'),
            expiresAt,
            createdAt: rtcToken.createdAt,
        };
    }
};
exports.RtcTokensService = RtcTokensService;
exports.RtcTokensService = RtcTokensService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        rooms_service_1.RoomsService,
        config_1.ConfigService])
], RtcTokensService);
//# sourceMappingURL=rtc-tokens.service.js.map