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
exports.MessageRouterService = void 0;
const common_1 = require("@nestjs/common");
const room_registry_service_1 = require("../rooms/room-registry.service");
const signaling_error_1 = require("../signaling-error");
const signaling_constants_1 = require("../signaling.constants");
let MessageRouterService = class MessageRouterService {
    constructor(roomRegistry) {
        this.roomRegistry = roomRegistry;
    }
    route(session, message) {
        switch (message.type) {
            case signaling_constants_1.ClientMessageType.ROOM_JOIN:
                return this.handleJoin(session, message);
            case signaling_constants_1.ClientMessageType.ROOM_LEAVE:
                return this.handleLeave(session);
            case signaling_constants_1.ClientMessageType.SDP_OFFER:
                return this.handleSdpOffer(session, message);
            case signaling_constants_1.ClientMessageType.SDP_ANSWER:
                return this.handleSdpAnswer(session, message);
            case signaling_constants_1.ClientMessageType.ICE_CANDIDATE:
                return this.handleIceCandidate(session, message);
            case signaling_constants_1.ClientMessageType.PING:
                return { toSender: { type: signaling_constants_1.ServerMessageType.PONG } };
        }
    }
    handleJoin(session, message) {
        if (!session.permissions.join) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.PERMISSION_DENIED, 'join permission required');
        }
        if (message.roomId && message.roomId !== session.roomId) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.UNAUTHORIZED, 'roomId does not match the room authorized by this RTC token');
        }
        const { replaced, existingParticipants } = this.roomRegistry.join(session);
        session.joinedRoom = true;
        session.joinedAt = new Date();
        return {
            toSender: {
                type: signaling_constants_1.ServerMessageType.ROOM_JOINED,
                roomId: session.roomId,
                participants: existingParticipants.map((p) => ({ id: p.participantId })),
            },
            toOthers: existingParticipants.map((p) => ({
                session: p,
                message: {
                    type: signaling_constants_1.ServerMessageType.PARTICIPANT_JOINED,
                    participant: { id: session.participantId },
                },
            })),
            kick: replaced ?? undefined,
        };
    }
    handleLeave(session) {
        this.requireInRoom(session);
        const removed = this.roomRegistry.leave(session.roomId, session.participantId);
        session.joinedRoom = false;
        const others = this.roomRegistry.listParticipants(session.roomId);
        return {
            toSender: { type: signaling_constants_1.ServerMessageType.ROOM_LEFT, roomId: session.roomId },
            toOthers: removed
                ? others.map((p) => ({
                    session: p,
                    message: {
                        type: signaling_constants_1.ServerMessageType.PARTICIPANT_LEFT,
                        participant: { id: session.participantId },
                    },
                }))
                : [],
        };
    }
    handleSdpOffer(session, message) {
        const target = this.resolveTarget(session, message.targetParticipantId);
        return {
            toOthers: [
                {
                    session: target,
                    message: {
                        type: signaling_constants_1.ServerMessageType.SDP_OFFER,
                        fromParticipantId: session.participantId,
                        sdp: message.sdp,
                    },
                },
            ],
        };
    }
    handleSdpAnswer(session, message) {
        const target = this.resolveTarget(session, message.targetParticipantId);
        return {
            toOthers: [
                {
                    session: target,
                    message: {
                        type: signaling_constants_1.ServerMessageType.SDP_ANSWER,
                        fromParticipantId: session.participantId,
                        sdp: message.sdp,
                    },
                },
            ],
        };
    }
    handleIceCandidate(session, message) {
        const target = this.resolveTarget(session, message.targetParticipantId);
        return {
            toOthers: [
                {
                    session: target,
                    message: {
                        type: signaling_constants_1.ServerMessageType.ICE_CANDIDATE,
                        fromParticipantId: session.participantId,
                        candidate: message.candidate,
                    },
                },
            ],
        };
    }
    resolveTarget(session, targetParticipantId) {
        this.requireInRoom(session);
        if (targetParticipantId === session.participantId) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE, 'Cannot target yourself');
        }
        const target = this.roomRegistry.get(session.roomId, targetParticipantId);
        if (!target) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.PARTICIPANT_NOT_FOUND, `Participant ${targetParticipantId} not found in this room`);
        }
        return target;
    }
    requireInRoom(session) {
        if (!session.joinedRoom) {
            throw new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.NOT_IN_ROOM, 'You have not joined a room yet');
        }
    }
};
exports.MessageRouterService = MessageRouterService;
exports.MessageRouterService = MessageRouterService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [room_registry_service_1.RoomRegistryService])
], MessageRouterService);
//# sourceMappingURL=message-router.service.js.map