"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertTextWithinLimits = assertTextWithinLimits;
exports.assertMetadataWithinLimits = assertMetadataWithinLimits;
exports.assertMessageBodyPresent = assertMessageBodyPresent;
exports.assertMessageTypeAllowed = assertMessageTypeAllowed;
const client_1 = require("../../../generated/prisma/client");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
function assertTextWithinLimits(text, limits) {
    if (text == null) {
        return;
    }
    if (typeof text !== 'string') {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'text must be a string');
    }
    const length = [...text].length;
    if (length > limits.maxTextLength) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_TOO_LARGE, `Message text is ${length} characters — the limit is ${limits.maxTextLength}`);
    }
}
function assertMetadataWithinLimits(metadata, limits) {
    if (metadata == null) {
        return;
    }
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'metadata must be a JSON object');
    }
    const bytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
    if (bytes > limits.maxMetadataBytes) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_TOO_LARGE, `metadata is ${bytes} bytes — the limit is ${limits.maxMetadataBytes}`);
    }
}
function assertMessageBodyPresent(type, text, attachmentId) {
    const hasText = typeof text === 'string' && text.trim().length > 0;
    if (type === client_1.MessageType.TEXT && !hasText) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'A text message needs non-empty text');
    }
    if (type === client_1.MessageType.ATTACHMENT && !attachmentId) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'An attachment message needs an attachmentId');
    }
}
function assertMessageTypeAllowed(type, actorKind) {
    if (actorKind === 'server') {
        return;
    }
    if (type === client_1.MessageType.SYSTEM || type === client_1.MessageType.EVENT) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.PERMISSION_DENIED, `${type.toLowerCase()} messages can only be sent server-side with a project API key`);
    }
}
//# sourceMappingURL=message-limits.util.js.map