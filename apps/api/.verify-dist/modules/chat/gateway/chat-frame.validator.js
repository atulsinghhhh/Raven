"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClientFrame = parseClientFrame;
exports.requireString = requireString;
exports.optionalString = optionalString;
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const CLIENT_FRAME_TYPES = new Set(Object.values(chat_constants_1.ChatClientFrame));
function parseClientFrame(data, maxBytes) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.byteLength > maxBytes) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.MESSAGE_TOO_LARGE, `Frame is ${buffer.byteLength} bytes — the limit is ${maxBytes}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(buffer.toString('utf8'));
    }
    catch {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'Frame is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'Frame must be a JSON object');
    }
    const frame = parsed;
    if (typeof frame.type !== 'string' || !CLIENT_FRAME_TYPES.has(frame.type)) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE_TYPE, `Unsupported frame type "${String(frame.type).slice(0, 40)}"`);
    }
    if (frame.id !== undefined && (typeof frame.id !== 'string' || frame.id.length > 128)) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'Frame id must be a string of at most 128 characters');
    }
    return frame;
}
function requireString(frame, field, maxLength = 256) {
    const value = frame[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, `"${field}" is required`);
    }
    if (value.length > maxLength) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, `"${field}" is too long`);
    }
    return value;
}
function optionalString(frame, field, maxLength = 256) {
    const value = frame[field];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string' || value.length > maxLength) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, `"${field}" must be a string of at most ${maxLength} characters`);
    }
    return value;
}
//# sourceMappingURL=chat-frame.validator.js.map