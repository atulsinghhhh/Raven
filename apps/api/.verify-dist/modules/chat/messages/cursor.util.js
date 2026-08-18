"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeCursor = encodeCursor;
exports.decodeCursor = decodeCursor;
exports.cursorFilter = cursorFilter;
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
function encodeCursor(cursor) {
    return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.publicId}`, 'utf8').toString('base64url');
}
function decodeCursor(raw) {
    let decoded;
    try {
        decoded = Buffer.from(raw, 'base64url').toString('utf8');
    }
    catch {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_CURSOR, 'Cursor is malformed');
    }
    const separator = decoded.indexOf('|');
    if (separator === -1) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_CURSOR, 'Cursor is malformed');
    }
    const createdAt = new Date(decoded.slice(0, separator));
    const publicId = decoded.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !publicId) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_CURSOR, 'Cursor is malformed');
    }
    return { createdAt, publicId };
}
function cursorFilter(cursor, direction) {
    const comparison = direction === 'before' ? 'lt' : 'gt';
    return {
        OR: [
            { createdAt: { [comparison]: cursor.createdAt } },
            { createdAt: cursor.createdAt, publicId: { [comparison]: cursor.publicId } },
        ],
    };
}
//# sourceMappingURL=cursor.util.js.map