"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTurnCredential = generateTurnCredential;
exports.buildIceServers = buildIceServers;
const crypto_1 = require("crypto");
function generateTurnCredential(secret, ttlSeconds, label) {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiresAt}:${label}`;
    const credential = (0, crypto_1.createHmac)('sha1', secret).update(username).digest('base64');
    return { username, credential };
}
function buildIceServers(opts) {
    const { username, credential } = generateTurnCredential(opts.turnSecret, opts.ttlSeconds, opts.participantIdentity);
    const hostPort = `${opts.turnHost}:${opts.turnPort}`;
    const servers = [
        { urls: `stun:${hostPort}` },
        { urls: `turn:${hostPort}?transport=udp`, username, credential },
        { urls: `turn:${hostPort}?transport=tcp`, username, credential },
    ];
    if (opts.turnTlsPort) {
        servers.push({
            urls: `turns:${opts.turnHost}:${opts.turnTlsPort}?transport=tcp`,
            username,
            credential,
        });
    }
    return servers;
}
//# sourceMappingURL=turn-credential.util.js.map