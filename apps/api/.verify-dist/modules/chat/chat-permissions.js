"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_SCOPES = void 0;
exports.scopesForRole = scopesForRole;
exports.isChatScope = isChatScope;
exports.narrowScopes = narrowScopes;
exports.assertScope = assertScope;
const chat_error_1 = require("./chat-error");
const chat_constants_1 = require("./chat.constants");
exports.CHAT_SCOPES = ['chat:read', 'chat:send', 'chat:moderate', 'chat:manage'];
const ROLE_SCOPES = {
    MEMBER: ['chat:read', 'chat:send'],
    MODERATOR: ['chat:read', 'chat:send', 'chat:moderate'],
    ADMIN: ['chat:read', 'chat:send', 'chat:moderate', 'chat:manage'],
};
function scopesForRole(role) {
    return [...ROLE_SCOPES[role]];
}
function isChatScope(value) {
    return typeof value === 'string' && exports.CHAT_SCOPES.includes(value);
}
function narrowScopes(roleScopes, requested) {
    if (!requested || requested.length === 0) {
        return roleScopes;
    }
    return roleScopes.filter((scope) => requested.includes(scope));
}
function assertScope(scopes, required, action) {
    if (!scopes.includes(required)) {
        throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.PERMISSION_DENIED, `${action} requires the "${required}" permission`);
    }
}
//# sourceMappingURL=chat-permissions.js.map