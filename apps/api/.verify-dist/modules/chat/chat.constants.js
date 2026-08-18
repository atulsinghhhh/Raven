"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisKeys = exports.CHAT_CLOSE_SERVER_SHUTDOWN = exports.CHAT_CLOSE_TOKEN_EXPIRED = exports.CHAT_CLOSE_RATE_LIMITED = exports.CHAT_CLOSE_FORBIDDEN = exports.CHAT_CLOSE_AUTH_FAILED = exports.CHAT_PRESENCE_REFRESH_MS = exports.CHAT_HEARTBEAT_INTERVAL_MS = exports.CHAT_API_VERSION = exports.CHAT_PATH = exports.PresenceStatus = exports.ChatErrorCode = exports.ChatServerFrame = exports.ChatClientFrame = void 0;
var ChatClientFrame;
(function (ChatClientFrame) {
    ChatClientFrame["ROOM_JOIN"] = "room.join";
    ChatClientFrame["ROOM_LEAVE"] = "room.leave";
    ChatClientFrame["MESSAGE_SEND"] = "message.send";
    ChatClientFrame["MESSAGE_UPDATE"] = "message.update";
    ChatClientFrame["MESSAGE_DELETE"] = "message.delete";
    ChatClientFrame["REACTION_ADD"] = "reaction.add";
    ChatClientFrame["REACTION_REMOVE"] = "reaction.remove";
    ChatClientFrame["TYPING_START"] = "typing.start";
    ChatClientFrame["TYPING_STOP"] = "typing.stop";
    ChatClientFrame["READ_MARK"] = "read.mark";
    ChatClientFrame["PRESENCE_SET"] = "presence.set";
    ChatClientFrame["PING"] = "ping";
})(ChatClientFrame || (exports.ChatClientFrame = ChatClientFrame = {}));
var ChatServerFrame;
(function (ChatServerFrame) {
    ChatServerFrame["CONNECTED"] = "connected";
    ChatServerFrame["ACK"] = "ack";
    ChatServerFrame["ERROR"] = "error";
    ChatServerFrame["ROOM_JOINED"] = "room.joined";
    ChatServerFrame["ROOM_LEFT"] = "room.left";
    ChatServerFrame["MESSAGE"] = "message";
    ChatServerFrame["MESSAGE_UPDATED"] = "message.updated";
    ChatServerFrame["MESSAGE_DELETED"] = "message.deleted";
    ChatServerFrame["REACTION_ADDED"] = "reaction.added";
    ChatServerFrame["REACTION_REMOVED"] = "reaction.removed";
    ChatServerFrame["TYPING_STARTED"] = "typing.started";
    ChatServerFrame["TYPING_STOPPED"] = "typing.stopped";
    ChatServerFrame["PRESENCE"] = "presence";
    ChatServerFrame["READ"] = "read";
    ChatServerFrame["PONG"] = "pong";
})(ChatServerFrame || (exports.ChatServerFrame = ChatServerFrame = {}));
var ChatErrorCode;
(function (ChatErrorCode) {
    ChatErrorCode["INVALID_TOKEN"] = "INVALID_TOKEN";
    ChatErrorCode["TOKEN_EXPIRED"] = "TOKEN_EXPIRED";
    ChatErrorCode["TOKEN_REVOKED"] = "TOKEN_REVOKED";
    ChatErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ChatErrorCode["PERMISSION_DENIED"] = "PERMISSION_DENIED";
    ChatErrorCode["ORIGIN_NOT_ALLOWED"] = "ORIGIN_NOT_ALLOWED";
    ChatErrorCode["ROOM_NOT_FOUND"] = "ROOM_NOT_FOUND";
    ChatErrorCode["NOT_IN_ROOM"] = "NOT_IN_ROOM";
    ChatErrorCode["NOT_A_MEMBER"] = "NOT_A_MEMBER";
    ChatErrorCode["TOO_MANY_SUBSCRIPTIONS"] = "TOO_MANY_SUBSCRIPTIONS";
    ChatErrorCode["MESSAGE_NOT_FOUND"] = "MESSAGE_NOT_FOUND";
    ChatErrorCode["MESSAGE_DELETED"] = "MESSAGE_DELETED";
    ChatErrorCode["INVALID_MESSAGE"] = "INVALID_MESSAGE";
    ChatErrorCode["INVALID_MESSAGE_TYPE"] = "INVALID_MESSAGE_TYPE";
    ChatErrorCode["MESSAGE_TOO_LARGE"] = "MESSAGE_TOO_LARGE";
    ChatErrorCode["INVALID_CURSOR"] = "INVALID_CURSOR";
    ChatErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
    ChatErrorCode["ATTACHMENT_NOT_FOUND"] = "ATTACHMENT_NOT_FOUND";
    ChatErrorCode["ATTACHMENTS_NOT_CONFIGURED"] = "ATTACHMENTS_NOT_CONFIGURED";
    ChatErrorCode["ATTACHMENT_TOO_LARGE"] = "ATTACHMENT_TOO_LARGE";
    ChatErrorCode["CONVERSATION_ARCHIVED"] = "CONVERSATION_ARCHIVED";
    ChatErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(ChatErrorCode || (exports.ChatErrorCode = ChatErrorCode = {}));
var PresenceStatus;
(function (PresenceStatus) {
    PresenceStatus["ONLINE"] = "online";
    PresenceStatus["AWAY"] = "away";
    PresenceStatus["OFFLINE"] = "offline";
})(PresenceStatus || (exports.PresenceStatus = PresenceStatus = {}));
exports.CHAT_PATH = '/v1/chat/ws';
exports.CHAT_API_VERSION = 'v1';
exports.CHAT_HEARTBEAT_INTERVAL_MS = 25_000;
exports.CHAT_PRESENCE_REFRESH_MS = 20_000;
exports.CHAT_CLOSE_AUTH_FAILED = 4401;
exports.CHAT_CLOSE_FORBIDDEN = 4403;
exports.CHAT_CLOSE_RATE_LIMITED = 4429;
exports.CHAT_CLOSE_TOKEN_EXPIRED = 4440;
exports.CHAT_CLOSE_SERVER_SHUTDOWN = 4500;
exports.RedisKeys = {
    conversationChannel: (projectId, conversationId) => `raven:chat:events:${projectId}:${conversationId}`,
    presence: (projectId, conversationId, userId) => `raven:presence:${projectId}:${conversationId}:${userId}`,
    presenceIndex: (projectId, conversationId) => `raven:presence:index:${projectId}:${conversationId}`,
    typing: (projectId, conversationId, userId) => `raven:typing:${projectId}:${conversationId}:${userId}`,
    typingIndex: (projectId, conversationId) => `raven:typing:index:${projectId}:${conversationId}`,
    connection: (connectionId) => `raven:chat:conn:${connectionId}`,
    userConnections: (projectId, userId) => `raven:chat:user:${projectId}:${userId}`,
    idempotency: (projectId, conversationId, senderId, clientMessageId) => `raven:chat:idem:${projectId}:${conversationId}:${senderId}:${clientMessageId}`,
    rateLimit: (scope, projectId, subject) => `raven:chat:ratelimit:${scope}:${projectId}:${subject}`,
    revokedToken: (jti) => `raven:chat:token:revoked:${jti}`,
    metricCounter: (projectId, metric, bucket) => `raven:chat:metrics:${projectId}:${metric}:${bucket}`,
    webhookWorkerLock: 'raven:webhooks:worker:lock',
    chatRetentionLock: 'raven:chat:retention:lock',
};
//# sourceMappingURL=chat.constants.js.map