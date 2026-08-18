import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';
import { ChatErrorCode, ChatServerFrame } from './chat.constants';

/**
 * One error type for the whole chat plane, thrown by services and
 * translated at whichever edge caught it: the HTTP filter turns it into a
 * JSON body, the gateway turns it into an `error` frame. That's why it
 * extends AppError — a service doesn't need to know which transport it's
 * being called through.
 */
export class ChatError extends AppError {
  readonly chatCode: ChatErrorCode;
  /** Only set on RATE_LIMITED — seconds until the caller may retry. */
  readonly retryAfterSeconds?: number;

  constructor(code: ChatErrorCode, message: string, retryAfterSeconds?: number) {
    super(
      message,
      statusFor(code),
      code,
      retryAfterSeconds !== undefined ? { retryAfterSeconds } : undefined,
    );
    this.chatCode = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** The `error` frame shape defined in docs/chat/websocket.md. */
  toFrame(correlationId?: string) {
    return {
      type: ChatServerFrame.ERROR,
      ...(correlationId ? { id: correlationId } : {}),
      code: this.chatCode,
      message: this.message,
      ...(this.retryAfterSeconds !== undefined ? { retryAfterSeconds: this.retryAfterSeconds } : {}),
    };
  }
}

function statusFor(code: ChatErrorCode): HttpStatus {
  switch (code) {
    case ChatErrorCode.INVALID_TOKEN:
    case ChatErrorCode.TOKEN_EXPIRED:
    case ChatErrorCode.TOKEN_REVOKED:
    case ChatErrorCode.UNAUTHORIZED:
      return HttpStatus.UNAUTHORIZED;
    case ChatErrorCode.PERMISSION_DENIED:
    case ChatErrorCode.NOT_A_MEMBER:
    case ChatErrorCode.ORIGIN_NOT_ALLOWED:
      return HttpStatus.FORBIDDEN;
    case ChatErrorCode.ROOM_NOT_FOUND:
    case ChatErrorCode.MESSAGE_NOT_FOUND:
    case ChatErrorCode.ATTACHMENT_NOT_FOUND:
      return HttpStatus.NOT_FOUND;
    case ChatErrorCode.MESSAGE_TOO_LARGE:
    case ChatErrorCode.ATTACHMENT_TOO_LARGE:
      return HttpStatus.PAYLOAD_TOO_LARGE;
    case ChatErrorCode.RATE_LIMITED:
      return HttpStatus.TOO_MANY_REQUESTS;
    case ChatErrorCode.CONVERSATION_ARCHIVED:
    case ChatErrorCode.MESSAGE_DELETED:
      return HttpStatus.CONFLICT;
    case ChatErrorCode.ATTACHMENTS_NOT_CONFIGURED:
      return HttpStatus.NOT_IMPLEMENTED;
    case ChatErrorCode.INTERNAL_ERROR:
      return HttpStatus.INTERNAL_SERVER_ERROR;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}
