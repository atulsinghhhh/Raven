"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBHOOK_TOLERANCE_SECONDS = exports.WEBHOOK_EVENT_TYPE_HEADER = exports.WEBHOOK_EVENT_ID_HEADER = exports.WEBHOOK_SIGNATURE_HEADER = void 0;
exports.signWebhookPayload = signWebhookPayload;
exports.verifyWebhookSignature = verifyWebhookSignature;
const crypto_1 = require("crypto");
exports.WEBHOOK_SIGNATURE_HEADER = 'raven-signature';
exports.WEBHOOK_EVENT_ID_HEADER = 'raven-event-id';
exports.WEBHOOK_EVENT_TYPE_HEADER = 'raven-event-type';
exports.WEBHOOK_TOLERANCE_SECONDS = 300;
function signWebhookPayload(rawBody, secret, timestampSeconds) {
    const signature = (0, crypto_1.createHmac)('sha256', secret)
        .update(`${timestampSeconds}.${rawBody}`)
        .digest('hex');
    return `t=${timestampSeconds},v1=${signature}`;
}
function verifyWebhookSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = exports.WEBHOOK_TOLERANCE_SECONDS) {
    const parts = Object.fromEntries(header
        .split(',')
        .map((part) => part.trim().split('='))
        .filter((pair) => pair.length === 2));
    const timestamp = Number(parts.t);
    const provided = parts.v1;
    if (!Number.isFinite(timestamp) || !provided) {
        return false;
    }
    if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
        return false;
    }
    const expected = (0, crypto_1.createHmac)('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const providedBuffer = Buffer.from(provided, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (providedBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(providedBuffer, expectedBuffer);
}
//# sourceMappingURL=webhook-signature.util.js.map