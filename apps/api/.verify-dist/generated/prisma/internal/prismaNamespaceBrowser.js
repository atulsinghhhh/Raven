"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonNullValueFilter = exports.NullsOrder = exports.QueryMode = exports.JsonNullValueInput = exports.NullableJsonNullValueInput = exports.SortOrder = exports.WebhookDeliveryScalarFieldEnum = exports.WebhookEventScalarFieldEnum = exports.WebhookEndpointScalarFieldEnum = exports.ChatConnectionScalarFieldEnum = exports.AttachmentScalarFieldEnum = exports.ReadStateScalarFieldEnum = exports.ReactionScalarFieldEnum = exports.MessageScalarFieldEnum = exports.ChatMemberScalarFieldEnum = exports.ConversationScalarFieldEnum = exports.ErrorEventScalarFieldEnum = exports.ConnectionEventScalarFieldEnum = exports.ConnectionScalarFieldEnum = exports.RtcTokenScalarFieldEnum = exports.ParticipantScalarFieldEnum = exports.RoomScalarFieldEnum = exports.ApiKeyScalarFieldEnum = exports.ProjectScalarFieldEnum = exports.UserScalarFieldEnum = exports.TransactionIsolationLevel = exports.ModelName = exports.AnyNull = exports.JsonNull = exports.DbNull = exports.NullTypes = exports.Decimal = void 0;
const runtime = __importStar(require("@prisma/client/runtime/index-browser"));
exports.Decimal = runtime.Decimal;
exports.NullTypes = {
    DbNull: runtime.NullTypes.DbNull,
    JsonNull: runtime.NullTypes.JsonNull,
    AnyNull: runtime.NullTypes.AnyNull,
};
exports.DbNull = runtime.DbNull;
exports.JsonNull = runtime.JsonNull;
exports.AnyNull = runtime.AnyNull;
exports.ModelName = {
    User: 'User',
    Project: 'Project',
    ApiKey: 'ApiKey',
    Room: 'Room',
    Participant: 'Participant',
    RtcToken: 'RtcToken',
    Connection: 'Connection',
    ConnectionEvent: 'ConnectionEvent',
    ErrorEvent: 'ErrorEvent',
    Conversation: 'Conversation',
    ChatMember: 'ChatMember',
    Message: 'Message',
    Reaction: 'Reaction',
    ReadState: 'ReadState',
    Attachment: 'Attachment',
    ChatConnection: 'ChatConnection',
    WebhookEndpoint: 'WebhookEndpoint',
    WebhookEvent: 'WebhookEvent',
    WebhookDelivery: 'WebhookDelivery'
};
exports.TransactionIsolationLevel = runtime.makeStrictEnum({
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
});
exports.UserScalarFieldEnum = {
    id: 'id',
    email: 'email',
    passwordHash: 'passwordHash',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ProjectScalarFieldEnum = {
    id: 'id',
    name: 'name',
    description: 'description',
    status: 'status',
    ownerId: 'ownerId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ApiKeyScalarFieldEnum = {
    id: 'id',
    projectId: 'projectId',
    publicId: 'publicId',
    secretHash: 'secretHash',
    name: 'name',
    status: 'status',
    lastUsedAt: 'lastUsedAt',
    createdAt: 'createdAt',
    revokedAt: 'revokedAt'
};
exports.RoomScalarFieldEnum = {
    id: 'id',
    projectId: 'projectId',
    name: 'name',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ParticipantScalarFieldEnum = {
    id: 'id',
    roomId: 'roomId',
    identity: 'identity',
    status: 'status',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.RtcTokenScalarFieldEnum = {
    id: 'id',
    projectId: 'projectId',
    roomId: 'roomId',
    participantId: 'participantId',
    permissions: 'permissions',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt'
};
exports.ConnectionScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    roomId: 'roomId',
    roomName: 'roomName',
    participantId: 'participantId',
    participantIdentity: 'participantIdentity',
    state: 'state',
    disconnectReason: 'disconnectReason',
    region: 'region',
    sdkVersion: 'sdkVersion',
    platform: 'platform',
    browser: 'browser',
    networkType: 'networkType',
    iceConnectionState: 'iceConnectionState',
    signalingState: 'signalingState',
    reconnectCount: 'reconnectCount',
    startedAt: 'startedAt',
    connectedAt: 'connectedAt',
    disconnectedAt: 'disconnectedAt',
    durationMs: 'durationMs',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ConnectionEventScalarFieldEnum = {
    id: 'id',
    connectionId: 'connectionId',
    type: 'type',
    data: 'data',
    timestamp: 'timestamp'
};
exports.ErrorEventScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    connectionId: 'connectionId',
    roomId: 'roomId',
    participantId: 'participantId',
    category: 'category',
    message: 'message',
    likelyCause: 'likelyCause',
    suggestedAction: 'suggestedAction',
    sdkVersion: 'sdkVersion',
    platform: 'platform',
    timestamp: 'timestamp'
};
exports.ConversationScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    roomId: 'roomId',
    name: 'name',
    type: 'type',
    status: 'status',
    retentionDays: 'retentionDays',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ChatMemberScalarFieldEnum = {
    id: 'id',
    conversationId: 'conversationId',
    projectId: 'projectId',
    userId: 'userId',
    role: 'role',
    status: 'status',
    metadata: 'metadata',
    joinedAt: 'joinedAt',
    leftAt: 'leftAt'
};
exports.MessageScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    conversationId: 'conversationId',
    roomId: 'roomId',
    senderId: 'senderId',
    type: 'type',
    content: 'content',
    replyToMessageId: 'replyToMessageId',
    threadRootId: 'threadRootId',
    clientMessageId: 'clientMessageId',
    metadata: 'metadata',
    editedAt: 'editedAt',
    deletedAt: 'deletedAt',
    deletedBy: 'deletedBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ReactionScalarFieldEnum = {
    id: 'id',
    messageId: 'messageId',
    conversationId: 'conversationId',
    projectId: 'projectId',
    userId: 'userId',
    emoji: 'emoji',
    createdAt: 'createdAt'
};
exports.ReadStateScalarFieldEnum = {
    id: 'id',
    conversationId: 'conversationId',
    projectId: 'projectId',
    userId: 'userId',
    lastReadMessageId: 'lastReadMessageId',
    lastReadAt: 'lastReadAt',
    updatedAt: 'updatedAt'
};
exports.AttachmentScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    conversationId: 'conversationId',
    messageId: 'messageId',
    uploaderId: 'uploaderId',
    filename: 'filename',
    mimeType: 'mimeType',
    sizeBytes: 'sizeBytes',
    storageKey: 'storageKey',
    status: 'status',
    metadata: 'metadata',
    createdAt: 'createdAt',
    uploadedAt: 'uploadedAt'
};
exports.ChatConnectionScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    conversationId: 'conversationId',
    userId: 'userId',
    gatewayId: 'gatewayId',
    state: 'state',
    disconnectReason: 'disconnectReason',
    sdkVersion: 'sdkVersion',
    platform: 'platform',
    messagesSent: 'messagesSent',
    connectedAt: 'connectedAt',
    disconnectedAt: 'disconnectedAt',
    durationMs: 'durationMs',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.WebhookEndpointScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    url: 'url',
    description: 'description',
    enabledEvents: 'enabledEvents',
    signingSecret: 'signingSecret',
    status: 'status',
    consecutiveFailures: 'consecutiveFailures',
    lastDeliveryAt: 'lastDeliveryAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.WebhookEventScalarFieldEnum = {
    id: 'id',
    publicId: 'publicId',
    projectId: 'projectId',
    type: 'type',
    payload: 'payload',
    createdAt: 'createdAt'
};
exports.WebhookDeliveryScalarFieldEnum = {
    id: 'id',
    eventId: 'eventId',
    endpointId: 'endpointId',
    status: 'status',
    attempts: 'attempts',
    nextAttemptAt: 'nextAttemptAt',
    responseStatus: 'responseStatus',
    lastError: 'lastError',
    deliveredAt: 'deliveredAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.SortOrder = {
    asc: 'asc',
    desc: 'desc'
};
exports.NullableJsonNullValueInput = {
    DbNull: exports.DbNull,
    JsonNull: exports.JsonNull
};
exports.JsonNullValueInput = {
    JsonNull: exports.JsonNull
};
exports.QueryMode = {
    default: 'default',
    insensitive: 'insensitive'
};
exports.NullsOrder = {
    first: 'first',
    last: 'last'
};
exports.JsonNullValueFilter = {
    DbNull: exports.DbNull,
    JsonNull: exports.JsonNull,
    AnyNull: exports.AnyNull
};
//# sourceMappingURL=prismaNamespaceBrowser.js.map