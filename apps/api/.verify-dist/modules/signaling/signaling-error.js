"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingError = void 0;
const signaling_constants_1 = require("./signaling.constants");
class SignalingError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
    toMessage() {
        return { type: signaling_constants_1.ServerMessageType.ERROR, code: this.code, message: this.message };
    }
}
exports.SignalingError = SignalingError;
//# sourceMappingURL=signaling-error.js.map