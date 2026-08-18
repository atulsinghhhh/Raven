"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ChatTokenService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatTokenService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
const crypto_util_1 = require("../../../shared/utils/crypto.util");
const redis_service_1 = require("../../../shared/redis/redis.service");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const chat_permissions_1 = require("../chat-permissions");
let ChatTokenService = ChatTokenService_1 = class ChatTokenService {
    constructor(configService, redisService) {
        this.configService = configService;
        this.redisService = redisService;
        this.logger = new common_1.Logger(ChatTokenService_1.name);
    }
    issue(input) {
        const maxTtl = this.configService.get('chat.tokenMaxTtlSeconds');
        const defaultTtl = this.configService.get('chat.tokenDefaultTtlSeconds');
        const ttlSeconds = Math.min(input.ttlSeconds ?? defaultTtl, maxTtl);
        const requested = input.requestedScopes?.filter(chat_permissions_1.isChatScope);
        const scopes = (0, chat_permissions_1.narrowScopes)((0, chat_permissions_1.scopesForRole)(input.role), requested);
        const issuedAt = Math.floor(Date.now() / 1000);
        const claims = {
            jti: (0, crypto_util_1.generateId)('ctk'),
            sub: input.userId,
            pid: input.projectId,
            cvs: input.conversations,
            scopes,
            iat: issuedAt,
            exp: issuedAt + ttlSeconds,
            aud: 'raven-chat',
            iss: 'raven',
        };
        return {
            token: this.sign(claims),
            tokenId: claims.jti,
            userId: claims.sub,
            projectId: claims.pid,
            scopes,
            conversations: claims.cvs,
            expiresAt: new Date(claims.exp * 1000),
            chatUrl: this.chatUrl(),
            apiUrl: this.configService.get('publicUrl'),
        };
    }
    async verify(rawToken) {
        const claims = this.decodeAndVerifySignature(rawToken);
        if (claims.aud !== 'raven-chat' || claims.iss !== 'raven') {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_TOKEN, 'This token was not issued for Raven Chat');
        }
        if (claims.exp * 1000 <= Date.now()) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.TOKEN_EXPIRED, 'Chat token has expired — mint a new one');
        }
        if (await this.isRevoked(claims.jti)) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.TOKEN_REVOKED, 'This chat token has been revoked');
        }
        return claims;
    }
    async revoke(tokenId, expiresAt) {
        const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
        await this.redisService.client.set(chat_constants_1.RedisKeys.revokedToken(tokenId), '1', 'EX', ttlSeconds);
    }
    async isRevoked(tokenId) {
        try {
            return (await this.redisService.client.exists(chat_constants_1.RedisKeys.revokedToken(tokenId))) === 1;
        }
        catch (err) {
            this.logger.error(`revocation check unavailable, allowing token: ${err.message}`);
            return false;
        }
    }
    sign(claims) {
        const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const payload = base64url(JSON.stringify(claims));
        const signature = this.hmac(`${header}.${payload}`);
        return `${header}.${payload}.${signature}`;
    }
    decodeAndVerifySignature(rawToken) {
        if (!rawToken || typeof rawToken !== 'string') {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_TOKEN, 'Missing chat token');
        }
        const parts = rawToken.split('.');
        if (parts.length !== 3) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_TOKEN, 'Chat token is malformed');
        }
        const [header, payload, signature] = parts;
        const expected = this.hmac(`${header}.${payload}`);
        const provided = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        if (provided.length !== expectedBuffer.length || !(0, crypto_1.timingSafeEqual)(provided, expectedBuffer)) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_TOKEN, 'Chat token signature is invalid');
        }
        try {
            return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        }
        catch {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_TOKEN, 'Chat token payload could not be decoded');
        }
    }
    hmac(input) {
        const secret = this.configService.get('chat.tokenSecret');
        return (0, crypto_1.createHmac)('sha256', secret).update(input).digest('base64url');
    }
    chatUrl() {
        const publicUrl = this.configService.get('publicUrl');
        const wsUrl = publicUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
        return `${wsUrl.replace(/\/$/, '')}/v1/chat/ws`;
    }
};
exports.ChatTokenService = ChatTokenService;
exports.ChatTokenService = ChatTokenService = ChatTokenService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        redis_service_1.RedisService])
], ChatTokenService);
function base64url(value) {
    return Buffer.from(value, 'utf8').toString('base64url');
}
//# sourceMappingURL=chat-token.service.js.map