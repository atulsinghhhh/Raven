/**
 * Every error `@ravenkash/chat` raises is one of these. Nobody using it ever
 * sees a raw `CloseEvent`, a Postgres constraint name or a Redis timeout.
 * That's the infrastructure Raven is supposed to be hiding (Phase 12
 * spec §42).
 */
export type ChatErrorCode =
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'UNAUTHORIZED'
  | 'PERMISSION_DENIED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'ROOM_NOT_FOUND'
  | 'NOT_IN_ROOM'
  | 'NOT_A_MEMBER'
  | 'TOO_MANY_SUBSCRIPTIONS'
  | 'MESSAGE_NOT_FOUND'
  | 'MESSAGE_DELETED'
  | 'INVALID_MESSAGE'
  | 'INVALID_MESSAGE_TYPE'
  | 'MESSAGE_TOO_LARGE'
  | 'INVALID_CURSOR'
  | 'RATE_LIMITED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENTS_NOT_CONFIGURED'
  | 'ATTACHMENT_TOO_LARGE'
  | 'CONVERSATION_ARCHIVED'
  | 'CONNECTION_FAILED'
  | 'CONNECTION_CLOSED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

/** Base class for every Raven Chat error. Catch this to catch them all. */
export class RavenChatError extends Error {
  readonly code: ChatErrorCode;
  readonly cause?: unknown;

  constructor(code: ChatErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'RavenChatError';
    this.code = code;
    this.cause = cause;
  }
}

/** The socket could not be opened, was lost, or gave up reconnecting. */
export class RavenChatConnectionError extends RavenChatError {
  constructor(message: string, code: ChatErrorCode = 'CONNECTION_FAILED', cause?: unknown) {
    super(code, message, cause);
    this.name = 'RavenChatConnectionError';
  }
}

/** The chat token is missing, malformed, expired or revoked. Mint a new one. */
export class RavenChatAuthenticationError extends RavenChatError {
  constructor(message: string, code: ChatErrorCode = 'INVALID_TOKEN', cause?: unknown) {
    super(code, message, cause);
    this.name = 'RavenChatAuthenticationError';
  }
}

/** Authenticated, but not allowed to do this. Wrong scope, or not a member. */
export class RavenChatPermissionError extends RavenChatError {
  constructor(message: string, code: ChatErrorCode = 'PERMISSION_DENIED', cause?: unknown) {
    super(code, message, cause);
    this.name = 'RavenChatPermissionError';
  }
}

/** A message operation failed: too large, not found, already deleted. */
export class RavenMessageError extends RavenChatError {
  constructor(message: string, code: ChatErrorCode = 'INVALID_MESSAGE', cause?: unknown) {
    super(code, message, cause);
    this.name = 'RavenMessageError';
  }
}

/** Slow down. `retryAfterSeconds` is how long, when the server told us. */
export class RavenRateLimitError extends RavenChatError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super('RATE_LIMITED', message);
    this.name = 'RavenRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The room/conversation doesn't exist, or this connection isn't in it. */
export class RavenRoomError extends RavenChatError {
  constructor(message: string, code: ChatErrorCode = 'ROOM_NOT_FOUND', cause?: unknown) {
    super(code, message, cause);
    this.name = 'RavenRoomError';
  }
}

/** An attachment upload, download, or reference failed. */
export class RavenAttachmentError extends RavenChatError {
  constructor(message: string, code: ChatErrorCode = 'ATTACHMENT_NOT_FOUND', cause?: unknown) {
    super(code, message, cause);
    this.name = 'RavenAttachmentError';
  }
}

export function isRavenChatError(value: unknown): value is RavenChatError {
  return value instanceof RavenChatError;
}

/**
 * Turns a server error code into the most specific class we have.
 *
 * One mapping, shared by the WebSocket and REST paths, so
 * `catch (e) { if (e instanceof RavenRateLimitError) ... }` behaves the same
 * no matter how the call was made.
 */
export function toRavenChatError(
  code: string | undefined,
  message: string,
  extra: { retryAfterSeconds?: number } = {},
): RavenChatError {
  const chatCode = (code ?? 'INTERNAL_ERROR') as ChatErrorCode;

  switch (chatCode) {
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
    case 'TOKEN_REVOKED':
    case 'UNAUTHORIZED':
      return new RavenChatAuthenticationError(message, chatCode);

    case 'PERMISSION_DENIED':
    case 'NOT_A_MEMBER':
    case 'ORIGIN_NOT_ALLOWED':
      return new RavenChatPermissionError(message, chatCode);

    case 'ROOM_NOT_FOUND':
    case 'NOT_IN_ROOM':
    case 'TOO_MANY_SUBSCRIPTIONS':
    case 'CONVERSATION_ARCHIVED':
      return new RavenRoomError(message, chatCode);

    case 'RATE_LIMITED':
      return new RavenRateLimitError(message, extra.retryAfterSeconds);

    case 'ATTACHMENT_NOT_FOUND':
    case 'ATTACHMENTS_NOT_CONFIGURED':
    case 'ATTACHMENT_TOO_LARGE':
      return new RavenAttachmentError(message, chatCode);

    case 'MESSAGE_NOT_FOUND':
    case 'MESSAGE_DELETED':
    case 'MESSAGE_TOO_LARGE':
    case 'INVALID_MESSAGE':
    case 'INVALID_MESSAGE_TYPE':
    case 'INVALID_CURSOR':
      return new RavenMessageError(message, chatCode);

    case 'CONNECTION_FAILED':
    case 'CONNECTION_CLOSED':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return new RavenChatConnectionError(message, chatCode);

    default:
      return new RavenChatError(chatCode, message);
  }
}
