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
exports.MessageValidatorService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const signaling_error_1 = require("../signaling-error");
const signaling_constants_1 = require("../signaling.constants");
const KNOWN_TYPES = new Set(Object.values(signaling_constants_1.ClientMessageType));
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
let MessageValidatorService = class MessageValidatorService {
    constructor(configService) {
        this.configService = configService;
    }
    parse(raw) {
        const byteLength = Buffer.isBuffer(raw)
            ? raw.length
            : Buffer.byteLength(typeof raw === 'string' ? raw : Buffer.from(raw));
        const maxBytes = this.configService.get('signaling.maxMessageBytes');
        if (byteLength > maxBytes) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE, `Message exceeds maximum size of ${maxBytes} bytes`);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw.toString());
        }
        catch {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE, 'Message is not valid JSON');
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE, 'Message must be a JSON object');
        }
        const candidate = parsed;
        const type = candidate.type;
        if (!isNonEmptyString(type) || !KNOWN_TYPES.has(type)) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE_TYPE, `Unknown message type: ${String(type)}`);
        }
        return this.validateByType(type, candidate);
    }
    validateByType(type, candidate) {
        switch (type) {
            case signaling_constants_1.ClientMessageType.ROOM_JOIN: {
                if (candidate.roomId !== undefined && !isNonEmptyString(candidate.roomId)) {
                    throw this.missingField('roomId');
                }
                return { type, roomId: candidate.roomId };
            }
            case signaling_constants_1.ClientMessageType.ROOM_LEAVE:
            case signaling_constants_1.ClientMessageType.PING:
                return { type };
            case signaling_constants_1.ClientMessageType.SDP_OFFER:
            case signaling_constants_1.ClientMessageType.SDP_ANSWER: {
                if (!isNonEmptyString(candidate.targetParticipantId)) {
                    throw this.missingField('targetParticipantId');
                }
                if (!isNonEmptyString(candidate.sdp)) {
                    throw this.missingField('sdp');
                }
                return {
                    type,
                    targetParticipantId: candidate.targetParticipantId,
                    sdp: candidate.sdp,
                };
            }
            case signaling_constants_1.ClientMessageType.ICE_CANDIDATE: {
                if (!isNonEmptyString(candidate.targetParticipantId)) {
                    throw this.missingField('targetParticipantId');
                }
                if (candidate.candidate === undefined || candidate.candidate === null) {
                    throw this.missingField('candidate');
                }
                return {
                    type,
                    targetParticipantId: candidate.targetParticipantId,
                    candidate: candidate.candidate,
                };
            }
            default:
                throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE_TYPE, `Unknown message type`);
        }
    }
    missingField(field) {
        return new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE, `Missing or invalid field: ${field}`);
    }
};
exports.MessageValidatorService = MessageValidatorService;
exports.MessageValidatorService = MessageValidatorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MessageValidatorService);
//# sourceMappingURL=message-validator.service.js.map