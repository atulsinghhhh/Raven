"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkMessageRate = checkMessageRate;
function checkMessageRate(session, maxMessages, windowSeconds) {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    session.messageTimestamps = session.messageTimestamps.filter((ts) => ts > windowStart);
    session.messageTimestamps.push(now);
    return session.messageTimestamps.length <= maxMessages;
}
//# sourceMappingURL=message-rate-limiter.util.js.map