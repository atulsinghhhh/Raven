import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { ChatErrorCode, ChatServerFrame } from './chat.constants';

/**
 * One error type for the whole chat plane, thrown by services and
 * translated at whichever edge caught it: the HTTP filter turns it into a
 * JSON body, the gateway turns it into an `error` frame. That's why it
 * extends AppError: a service doesn't need to know which transport it's
 * being called through.
 */
export class ChatError extends AppError {
  readonly chatCode: ChatErrorCode;
  /** Only set on RATE_LIMITED: seconds until the caller may retry. */
  readonly retryAfterSeconds?: number;

  constructor(code: ChatErrorCode, message: string, retryAfterSeconds?: number) {
    // Two vocabularies on purpose. The HTTP body gets the canonical
    // RAVEN_ code so a developer can handle chat and control-plane errors
    // with one switch; `toFrame()` below keeps the ChatErrorCode the
    // WebSocket protocol has always used and @ravenkash/chat already maps.
    super(
      message,
      statusFor(code),
      ravenCodeFor(code),
      {
        // The compat field reports exactly what this error used to emit;
        // the chat code itself, not whatever the canonical code's generic
        // legacy name happens to be. Anything mid-migration was reading
        // `INVALID_CURSOR`, not `VALIDATION_FAILED`.
        legacyCode: code,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      },
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

/**
 * ChatErrorCode is finer-grained than the canonical vocabulary, so this is
 * by design many-to-one: three distinct token failures all present as
 * RAVEN_TOKEN_EXPIRED or RAVEN_AUTH_ERROR over HTTP. The precise cause is
 * still in the message, and on the WebSocket the exact code survives.
 */
function ravenCodeFor(code: ChatErrorCode): RavenErrorCode {
  switch (code) {
    case ChatErrorCode.TOKEN_EXPIRED:
      return RavenErrorCode.TOKEN_EXPIRED;
    case ChatErrorCode.INVALID_TOKEN:
    case ChatErrorCode.TOKEN_REVOKED:
    case ChatErrorCode.UNAUTHORIZED:
      return RavenErrorCode.AUTH_ERROR;
    case ChatErrorCode.PERMISSION_DENIED:
    case ChatErrorCode.NOT_A_MEMBER:
    case ChatErrorCode.ORIGIN_NOT_ALLOWED:
      return RavenErrorCode.PERMISSION_DENIED;
    case ChatErrorCode.ROOM_NOT_FOUND:
      return RavenErrorCode.CONVERSATION_NOT_FOUND;
    case ChatErrorCode.MESSAGE_NOT_FOUND:
      return RavenErrorCode.MESSAGE_NOT_FOUND;
    case ChatErrorCode.ATTACHMENT_NOT_FOUND:
      return RavenErrorCode.ATTACHMENT_NOT_FOUND;
    case ChatErrorCode.MESSAGE_TOO_LARGE:
      return RavenErrorCode.MESSAGE_TOO_LARGE;
    case ChatErrorCode.ATTACHMENT_TOO_LARGE:
      return RavenErrorCode.ATTACHMENT_TOO_LARGE;
    case ChatErrorCode.INVALID_CURSOR:
      return RavenErrorCode.INVALID_CURSOR;
    case ChatErrorCode.RATE_LIMITED:
      return RavenErrorCode.RATE_LIMITED;
    case ChatErrorCode.CONVERSATION_ARCHIVED:
      return RavenErrorCode.CONVERSATION_ARCHIVED;
    case ChatErrorCode.MESSAGE_DELETED:
      return RavenErrorCode.CONFLICT;
    case ChatErrorCode.ATTACHMENTS_NOT_CONFIGURED:
      // 501, so a 4xx-shaped code here would point the developer at their
      // own request when the fix is on the operator's side.
      return RavenErrorCode.NOT_CONFIGURED;
    case ChatErrorCode.INTERNAL_ERROR:
      return RavenErrorCode.INTERNAL_ERROR;
    default:
      return RavenErrorCode.VALIDATION_FAILED;
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
