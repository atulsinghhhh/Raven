// Wire protocol + shared vocabulary for Livqeno Chat. The full contract is
// documented in docs/chat/websocket.md: this file is its source of truth,
// same arrangement as signaling.constants.ts for the RTC plane.
//
// Chat does NOT reuse the RTC signaling protocol, and that's on purpose.
// The two ride
// different sockets, carry different payloads, and version independently.

/** Frames a client may send. Anything else is rejected as INVALID_MESSAGE_TYPE. */
export enum ChatClientFrame {
  ROOM_JOIN = 'room.join',
  ROOM_LEAVE = 'room.leave',
  MESSAGE_SEND = 'message.send',
  MESSAGE_UPDATE = 'message.update',
  MESSAGE_DELETE = 'message.delete',
  REACTION_ADD = 'reaction.add',
  REACTION_REMOVE = 'reaction.remove',
  TYPING_START = 'typing.start',
  TYPING_STOP = 'typing.stop',
  READ_MARK = 'read.mark',
  PRESENCE_SET = 'presence.set',
  PING = 'ping',
}

/** Frames the gateway may send. */
export enum ChatServerFrame {
  /** First frame after a successful upgrade: carries the connection id. */
  CONNECTED = 'connected',
  /** Correlated reply to a client frame that carried an `id`. */
  ACK = 'ack',
  ERROR = 'error',
  ROOM_JOINED = 'room.joined',
  ROOM_LEFT = 'room.left',
  MESSAGE = 'message',
  MESSAGE_UPDATED = 'message.updated',
  MESSAGE_DELETED = 'message.deleted',
  REACTION_ADDED = 'reaction.added',
  REACTION_REMOVED = 'reaction.removed',
  TYPING_STARTED = 'typing.started',
  TYPING_STOPPED = 'typing.stopped',
  PRESENCE = 'presence',
  READ = 'read',
  PONG = 'pong',
}

/**
 * Stable, developer-facing error codes. Raw Postgres/Redis/ws failures
 * never reach a client: they are logged server-side and surface here as
 * INTERNAL_ERROR (spec §42).
 */
export enum ChatErrorCode {
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  ORIGIN_NOT_ALLOWED = 'ORIGIN_NOT_ALLOWED',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  NOT_IN_ROOM = 'NOT_IN_ROOM',
  NOT_A_MEMBER = 'NOT_A_MEMBER',
  TOO_MANY_SUBSCRIPTIONS = 'TOO_MANY_SUBSCRIPTIONS',
  MESSAGE_NOT_FOUND = 'MESSAGE_NOT_FOUND',
  MESSAGE_DELETED = 'MESSAGE_DELETED',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  INVALID_MESSAGE_TYPE = 'INVALID_MESSAGE_TYPE',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  INVALID_CURSOR = 'INVALID_CURSOR',
  RATE_LIMITED = 'RATE_LIMITED',
  ATTACHMENT_NOT_FOUND = 'ATTACHMENT_NOT_FOUND',
  ATTACHMENTS_NOT_CONFIGURED = 'ATTACHMENTS_NOT_CONFIGURED',
  ATTACHMENT_TOO_LARGE = 'ATTACHMENT_TOO_LARGE',
  CONVERSATION_ARCHIVED = 'CONVERSATION_ARCHIVED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Presence values. Ephemeral: never written to Postgres (spec §20). */
export enum PresenceStatus {
  ONLINE = 'online',
  AWAY = 'away',
  OFFLINE = 'offline',
}

// Operational constants, not per-deployment config: anything that varies
// by deployment (limits, TTLs, rates) lives under `chat` in configuration.ts.
export const CHAT_PATH = '/v1/chat/ws';
export const CHAT_API_VERSION = 'v1';
export const CHAT_HEARTBEAT_INTERVAL_MS = 25_000;
/** Presence/connection keys are refreshed on this cadence, well inside their TTL. */
export const CHAT_PRESENCE_REFRESH_MS = 20_000;

// 4000-4999 is the application-defined range (RFC 6455 §7.4.2). Kept
// distinct from signaling's codes so a developer reading a close code in
// devtools can tell which plane it came from.
export const CHAT_CLOSE_AUTH_FAILED = 4401;
export const CHAT_CLOSE_FORBIDDEN = 4403;
export const CHAT_CLOSE_RATE_LIMITED = 4429;
export const CHAT_CLOSE_TOKEN_EXPIRED = 4440;
export const CHAT_CLOSE_SERVER_SHUTDOWN = 4500;

/**
 * Redis key namespace. Every ephemeral key below carries a TTL: nothing
 * in Redis is a permanent record (spec §33). Documented in
 * docs/chat/architecture.md#redis-key-conventions.
 */
export const RedisKeys = {
  /** Pub/sub channel one per conversation; gateways subscribe on demand. */
  conversationChannel: (projectId: string, conversationId: string) =>
    `raven:chat:events:${projectId}:${conversationId}`,
  /** Per-user presence value + TTL. Expiry *is* the offline transition. */
  presence: (projectId: string, conversationId: string, userId: string) =>
    `raven:presence:${projectId}:${conversationId}:${userId}`,
  /**
   * The connections currently holding a user present in a conversation.
   *
   * Presence is a property of the *person*, but it is produced by
   * *connections*, and a person routinely has several — a laptop tab, a
   * phone, a second window. Without this set, the first one to close
   * deleted the shared presence key and broadcast `offline` while the
   * others were still live; the surviving connection only put it back on
   * its next heartbeat, so every closed tab cost every other participant a
   * spurious offline→online flap lasting up to CHAT_HEARTBEAT_INTERVAL_MS.
   *
   * So the value key above answers "what status", and this set answers
   * "is anyone still here". Same TTL as the value, refreshed by the same
   * heartbeat, so a gateway that dies without cleaning up still expires
   * out rather than pinning someone online forever.
   */
  presenceConnections: (projectId: string, conversationId: string, userId: string) =>
    `raven:presence:conns:${projectId}:${conversationId}:${userId}`,
  /** Sorted set of userId -> expiry ms, so listing a room's presence is one ZRANGEBYSCORE. */
  presenceIndex: (projectId: string, conversationId: string) => `raven:presence:index:${projectId}:${conversationId}`,
  typing: (projectId: string, conversationId: string, userId: string) =>
    `raven:typing:${projectId}:${conversationId}:${userId}`,
  /** Connections currently typing as this user. Same reference-counting reason as `presenceConnections`. */
  typingConnections: (projectId: string, conversationId: string, userId: string) =>
    `raven:typing:conns:${projectId}:${conversationId}:${userId}`,
  typingIndex: (projectId: string, conversationId: string) => `raven:typing:index:${projectId}:${conversationId}`,
  /** connectionId -> {gatewayId,userId,projectId}. Lets us find where a socket lives. */
  connection: (connectionId: string) => `raven:chat:conn:${connectionId}`,
  /** userId -> set of live connectionIds (a user may have several tabs). */
  userConnections: (projectId: string, userId: string) => `raven:chat:user:${projectId}:${userId}`,
  /** Fast-path duplicate detection ahead of the DB's unique constraint. */
  idempotency: (projectId: string, conversationId: string, senderId: string, clientMessageId: string) =>
    `raven:chat:idem:${projectId}:${conversationId}:${senderId}:${clientMessageId}`,
  rateLimit: (scope: string, projectId: string, subject: string) =>
    `raven:chat:ratelimit:${scope}:${projectId}:${subject}`,
  revokedToken: (jti: string) => `raven:chat:token:revoked:${jti}`,
  /** Rolling counters behind the dashboard's chat metrics. */
  metricCounter: (projectId: string, metric: string, bucket: string) =>
    `raven:chat:metrics:${projectId}:${metric}:${bucket}`,
  /** Held by whichever API instance is currently draining the webhook queue. */
  webhookWorkerLock: 'raven:webhooks:worker:lock',
  chatRetentionLock: 'raven:chat:retention:lock',
} as const;
