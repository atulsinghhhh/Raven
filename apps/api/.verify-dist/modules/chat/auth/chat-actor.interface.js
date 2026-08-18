"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canImpersonate = canImpersonate;
exports.resolveSubjectId = resolveSubjectId;
function canImpersonate(actor) {
    return actor.kind === 'server';
}
function resolveSubjectId(actor, requested) {
    if (actor.kind === 'client') {
        return actor.userId;
    }
    return requested ?? actor.userId;
}
//# sourceMappingURL=chat-actor.interface.js.map