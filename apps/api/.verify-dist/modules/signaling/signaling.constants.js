"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEARTBEAT_TIMEOUT_MS = exports.HEARTBEAT_INTERVAL_MS = exports.SIGNALING_PATH = exports.SignalingErrorCode = exports.ServerMessageType = exports.ClientMessageType = void 0;
var ClientMessageType;
(function (ClientMessageType) {
    ClientMessageType["ROOM_JOIN"] = "room.join";
    ClientMessageType["ROOM_LEAVE"] = "room.leave";
    ClientMessageType["SDP_OFFER"] = "sdp.offer";
    ClientMessageType["SDP_ANSWER"] = "sdp.answer";
    ClientMessageType["ICE_CANDIDATE"] = "ice.candidate";
    ClientMessageType["PING"] = "ping";
})(ClientMessageType || (exports.ClientMessageType = ClientMessageType = {}));
var ServerMessageType;
(function (ServerMessageType) {
    ServerMessageType["ROOM_JOINED"] = "room.joined";
    ServerMessageType["ROOM_LEFT"] = "room.left";
    ServerMessageType["PARTICIPANT_JOINED"] = "participant.joined";
    ServerMessageType["PARTICIPANT_LEFT"] = "participant.left";
    ServerMessageType["SDP_OFFER"] = "sdp.offer";
    ServerMessageType["SDP_ANSWER"] = "sdp.answer";
    ServerMessageType["ICE_CANDIDATE"] = "ice.candidate";
    ServerMessageType["ERROR"] = "error";
    ServerMessageType["PONG"] = "pong";
})(ServerMessageType || (exports.ServerMessageType = ServerMessageType = {}));
var SignalingErrorCode;
(function (SignalingErrorCode) {
    SignalingErrorCode["INVALID_TOKEN"] = "INVALID_TOKEN";
    SignalingErrorCode["TOKEN_EXPIRED"] = "TOKEN_EXPIRED";
    SignalingErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    SignalingErrorCode["ROOM_NOT_FOUND"] = "ROOM_NOT_FOUND";
    SignalingErrorCode["ROOM_FULL"] = "ROOM_FULL";
    SignalingErrorCode["INVALID_MESSAGE"] = "INVALID_MESSAGE";
    SignalingErrorCode["INVALID_MESSAGE_TYPE"] = "INVALID_MESSAGE_TYPE";
    SignalingErrorCode["PARTICIPANT_NOT_FOUND"] = "PARTICIPANT_NOT_FOUND";
    SignalingErrorCode["NOT_IN_ROOM"] = "NOT_IN_ROOM";
    SignalingErrorCode["PERMISSION_DENIED"] = "PERMISSION_DENIED";
    SignalingErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
})(SignalingErrorCode || (exports.SignalingErrorCode = SignalingErrorCode = {}));
exports.SIGNALING_PATH = '/v1/rtc';
exports.HEARTBEAT_INTERVAL_MS = 30_000;
exports.HEARTBEAT_TIMEOUT_MS = 60_000;
//# sourceMappingURL=signaling.constants.js.map