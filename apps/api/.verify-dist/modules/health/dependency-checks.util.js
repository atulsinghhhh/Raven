"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLiveKitHttp = checkLiveKitHttp;
exports.checkStunBinding = checkStunBinding;
const node_dgram_1 = require("node:dgram");
const node_crypto_1 = require("node:crypto");
async function checkLiveKitHttp(livekitUrl, timeoutMs = 2000) {
    const httpUrl = livekitUrl.replace(/^ws/, 'http');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(httpUrl, { signal: controller.signal });
        return res.ok;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timeout);
    }
}
const STUN_MAGIC_COOKIE = 0x2112a442;
const STUN_BINDING_REQUEST = 0x0001;
function checkStunBinding(host, port, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const socket = (0, node_dgram_1.createSocket)('udp4');
        const transactionId = (0, node_crypto_1.randomBytes)(12);
        const request = Buffer.alloc(20);
        request.writeUInt16BE(STUN_BINDING_REQUEST, 0);
        request.writeUInt16BE(0, 2);
        request.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
        transactionId.copy(request, 8);
        const finish = (result) => {
            clearTimeout(timer);
            socket.close();
            resolve(result);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        socket.once('error', () => finish(false));
        socket.once('message', (msg) => {
            const validResponse = msg.length >= 20 &&
                (msg.readUInt16BE(0) & 0x0110) !== 0 &&
                msg.readUInt32BE(4) === STUN_MAGIC_COOKIE &&
                msg.subarray(8, 20).equals(transactionId);
            finish(validResponse);
        });
        socket.send(request, port, host, (error) => {
            if (error)
                finish(false);
        });
    });
}
//# sourceMappingURL=dependency-checks.util.js.map