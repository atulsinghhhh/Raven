"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookDeliveryStatus = exports.WebhookEndpointStatus = exports.AttachmentStatus = exports.MessageType = exports.ChatMemberStatus = exports.ChatMemberRole = exports.ConversationStatus = exports.ConversationType = exports.ErrorCategory = exports.ConnectionState = exports.ParticipantStatus = exports.RoomStatus = exports.ApiKeyStatus = exports.ProjectStatus = void 0;
exports.ProjectStatus = {
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED'
};
exports.ApiKeyStatus = {
    ACTIVE: 'ACTIVE',
    REVOKED: 'REVOKED'
};
exports.RoomStatus = {
    ACTIVE: 'ACTIVE',
    CLOSED: 'CLOSED'
};
exports.ParticipantStatus = {
    PENDING: 'PENDING',
    JOINED: 'JOINED',
    LEFT: 'LEFT'
};
exports.ConnectionState = {
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    RECONNECTING: 'RECONNECTING',
    DISCONNECTED: 'DISCONNECTED',
    FAILED: 'FAILED'
};
exports.ErrorCategory = {
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    TOKEN_ERROR: 'TOKEN_ERROR',
    SIGNALING_ERROR: 'SIGNALING_ERROR',
    ICE_ERROR: 'ICE_ERROR',
    TURN_ERROR: 'TURN_ERROR',
    SFU_ERROR: 'SFU_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    CLIENT_ERROR: 'CLIENT_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};
exports.ConversationType = {
    ROOM: 'ROOM',
    CHANNEL: 'CHANNEL',
    DIRECT: 'DIRECT'
};
exports.ConversationStatus = {
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED'
};
exports.ChatMemberRole = {
    MEMBER: 'MEMBER',
    MODERATOR: 'MODERATOR',
    ADMIN: 'ADMIN'
};
exports.ChatMemberStatus = {
    ACTIVE: 'ACTIVE',
    LEFT: 'LEFT'
};
exports.MessageType = {
    TEXT: 'TEXT',
    SYSTEM: 'SYSTEM',
    EVENT: 'EVENT',
    ATTACHMENT: 'ATTACHMENT'
};
exports.AttachmentStatus = {
    PENDING: 'PENDING',
    UPLOADED: 'UPLOADED',
    EXPIRED: 'EXPIRED'
};
exports.WebhookEndpointStatus = {
    ACTIVE: 'ACTIVE',
    DISABLED: 'DISABLED'
};
exports.WebhookDeliveryStatus = {
    PENDING: 'PENDING',
    DELIVERED: 'DELIVERED',
    FAILED: 'FAILED'
};
//# sourceMappingURL=enums.js.map