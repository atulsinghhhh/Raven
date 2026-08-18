"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateApiKeyPublicId = generateApiKeyPublicId;
exports.generateApiKeySecret = generateApiKeySecret;
exports.generateId = generateId;
exports.pepper = pepper;
const crypto_1 = require("crypto");
const nanoid_1 = require("nanoid");
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const nanoid = (0, nanoid_1.customAlphabet)(alphabet, 12);
function generateApiKeyPublicId() {
    return `rvk_${nanoid()}`;
}
function generateApiKeySecret() {
    return (0, crypto_1.randomBytes)(32).toString('base64url');
}
function generateId(prefix) {
    return `${prefix}_${(0, crypto_1.randomBytes)(16).toString('base64url')}`;
}
function pepper(secret, pepperKey) {
    return (0, crypto_1.createHmac)('sha256', pepperKey).update(secret).digest('base64url');
}
//# sourceMappingURL=crypto.util.js.map