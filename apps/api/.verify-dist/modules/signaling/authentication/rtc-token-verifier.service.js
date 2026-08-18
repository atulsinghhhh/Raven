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
var RtcTokenVerifierService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RtcTokenVerifierService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const livekit_server_sdk_1 = require("livekit-server-sdk");
const rtc_token_grant_mapper_1 = require("../../rtc-tokens/rtc-token-grant.mapper");
const signaling_error_1 = require("../signaling-error");
const signaling_constants_1 = require("../signaling.constants");
let RtcTokenVerifierService = RtcTokenVerifierService_1 = class RtcTokenVerifierService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(RtcTokenVerifierService_1.name);
        this.verifier = new livekit_server_sdk_1.TokenVerifier(this.configService.get('livekit.apiKey'), this.configService.get('livekit.apiSecret'));
    }
    async verify(rawToken) {
        if (!rawToken || typeof rawToken !== 'string') {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_TOKEN, 'Missing RTC token');
        }
        let claims;
        try {
            claims = await this.verifier.verify(rawToken);
        }
        catch (err) {
            const code = this.classifyVerificationError(err);
            this.logger.warn(`RTC token rejected: ${code}`);
            throw new signaling_error_1.SignalingError(code, code === signaling_constants_1.SignalingErrorCode.TOKEN_EXPIRED
                ? 'RTC token has expired'
                : 'RTC token is invalid or malformed');
        }
        const participantId = claims.sub;
        const roomName = claims.video?.room;
        const projectId = claims.attributes?.ravenProjectId;
        const roomId = claims.attributes?.ravenRoomId;
        if (!participantId || !roomName || !projectId || !roomId) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_TOKEN, 'RTC token is missing required claims');
        }
        return {
            participantId,
            projectId,
            roomId,
            roomName,
            permissions: (0, rtc_token_grant_mapper_1.fromLiveKitGrant)(claims.video ?? {}),
            expiresAt: new Date((claims.exp ?? 0) * 1000),
        };
    }
    classifyVerificationError(err) {
        const code = err?.code;
        if (code === 'ERR_JWT_EXPIRED') {
            return signaling_constants_1.SignalingErrorCode.TOKEN_EXPIRED;
        }
        return signaling_constants_1.SignalingErrorCode.INVALID_TOKEN;
    }
};
exports.RtcTokenVerifierService = RtcTokenVerifierService;
exports.RtcTokenVerifierService = RtcTokenVerifierService = RtcTokenVerifierService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RtcTokenVerifierService);
//# sourceMappingURL=rtc-token-verifier.service.js.map