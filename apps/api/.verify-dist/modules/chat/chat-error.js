"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatError = void 0;
const common_1 = require("@nestjs/common");
const app_error_1 = require("../../shared/errors/app-error");
const chat_constants_1 = require("./chat.constants");
class ChatError extends app_error_1.AppError {
    constructor(code, message, retryAfterSeconds) {
        super(message, statusFor(code), code, retryAfterSeconds !== undefined ? { retryAfterSeconds } : undefined);
        this.chatCode = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
    toFrame(correlationId) {
        return {
            type: chat_constants_1.ChatServerFrame.ERROR,
            ...(correlationId ? { id: correlationId } : {}),
            code: this.chatCode,
            message: this.message,
            ...(this.retryAfterSeconds !== undefined ? { retryAfterSeconds: this.retryAfterSeconds } : {}),
        };
    }
}
exports.ChatError = ChatError;
function statusFor(code) {
    switch (code) {
        case chat_constants_1.ChatErrorCode.INVALID_TOKEN:
        case chat_constants_1.ChatErrorCode.TOKEN_EXPIRED:
        case chat_constants_1.ChatErrorCode.TOKEN_REVOKED:
        case chat_constants_1.ChatErrorCode.UNAUTHORIZED:
            return common_1.HttpStatus.UNAUTHORIZED;
        case chat_constants_1.ChatErrorCode.PERMISSION_DENIED:
        case chat_constants_1.ChatErrorCode.NOT_A_MEMBER:
        case chat_constants_1.ChatErrorCode.ORIGIN_NOT_ALLOWED:
            return common_1.HttpStatus.FORBIDDEN;
        case chat_constants_1.ChatErrorCode.ROOM_NOT_FOUND:
        case chat_constants_1.ChatErrorCode.MESSAGE_NOT_FOUND:
        case chat_constants_1.ChatErrorCode.ATTACHMENT_NOT_FOUND:
            return common_1.HttpStatus.NOT_FOUND;
        case chat_constants_1.ChatErrorCode.MESSAGE_TOO_LARGE:
        case chat_constants_1.ChatErrorCode.ATTACHMENT_TOO_LARGE:
            return common_1.HttpStatus.PAYLOAD_TOO_LARGE;
        case chat_constants_1.ChatErrorCode.RATE_LIMITED:
            return common_1.HttpStatus.TOO_MANY_REQUESTS;
        case chat_constants_1.ChatErrorCode.CONVERSATION_ARCHIVED:
        case chat_constants_1.ChatErrorCode.MESSAGE_DELETED:
            return common_1.HttpStatus.CONFLICT;
        case chat_constants_1.ChatErrorCode.ATTACHMENTS_NOT_CONFIGURED:
            return common_1.HttpStatus.NOT_IMPLEMENTED;
        case chat_constants_1.ChatErrorCode.INTERNAL_ERROR:
            return common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        default:
            return common_1.HttpStatus.BAD_REQUEST;
    }
}
//# sourceMappingURL=chat-error.js.map