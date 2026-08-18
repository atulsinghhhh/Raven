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
var SignalingGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingGateway = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const websockets_1 = require("@nestjs/websockets");
const crypto_1 = require("crypto");
const ws_1 = require("ws");
const rtc_token_verifier_service_1 = require("../authentication/rtc-token-verifier.service");
const message_router_service_1 = require("../messages/message-router.service");
const message_validator_service_1 = require("../messages/message-validator.service");
const connection_rate_limit_service_1 = require("../rate-limit/connection-rate-limit.service");
const message_rate_limiter_util_1 = require("../rate-limit/message-rate-limiter.util");
const room_registry_service_1 = require("../rooms/room-registry.service");
const signaling_error_1 = require("../signaling-error");
const signaling_constants_1 = require("../signaling.constants");
const CLOSE_AUTH_FAILED = 4001;
const CLOSE_REPLACED = 4002;
const CLOSE_RATE_LIMITED = 4029;
let SignalingGateway = SignalingGateway_1 = class SignalingGateway {
    constructor(tokenVerifier, roomRegistry, messageValidator, messageRouter, connectionRateLimit, configService) {
        this.tokenVerifier = tokenVerifier;
        this.roomRegistry = roomRegistry;
        this.messageValidator = messageValidator;
        this.messageRouter = messageRouter;
        this.connectionRateLimit = connectionRateLimit;
        this.configService = configService;
        this.logger = new common_1.Logger(SignalingGateway_1.name);
        this.sessions = new Map();
    }
    afterInit() {
        this.heartbeatTimer = setInterval(() => this.runHeartbeat(), signaling_constants_1.HEARTBEAT_INTERVAL_MS);
        this.logger.log(`Signaling gateway listening on ${signaling_constants_1.SIGNALING_PATH}`);
    }
    onModuleDestroy() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        for (const client of this.sessions.keys()) {
            client.terminate();
        }
    }
    async handleConnection(client, request) {
        client.pause();
        const clientIp = this.extractClientIp(request);
        const allowed = await this.connectionRateLimit.isAllowed(clientIp);
        if (!allowed) {
            this.logger.warn(`connection rate limited: ${clientIp}`);
            this.sendMessage(client, {
                type: signaling_constants_1.ServerMessageType.ERROR,
                code: signaling_constants_1.SignalingErrorCode.RATE_LIMITED,
                message: 'Too many connection attempts — please try again later',
            });
            client.resume();
            client.close(CLOSE_RATE_LIMITED, signaling_constants_1.SignalingErrorCode.RATE_LIMITED);
            return;
        }
        const token = this.extractToken(request);
        let verified;
        try {
            verified = await this.tokenVerifier.verify(token ?? '');
        }
        catch (err) {
            const signalingError = err instanceof signaling_error_1.SignalingError
                ? err
                : new signaling_error_1.SignalingError(signaling_constants_1.SignalingErrorCode.INVALID_TOKEN, 'Authentication failed');
            this.logger.warn(`authentication rejected from ${clientIp}: ${signalingError.code}`);
            this.sendMessage(client, signalingError.toMessage());
            client.resume();
            client.close(CLOSE_AUTH_FAILED, signalingError.code);
            return;
        }
        const session = {
            connectionId: (0, crypto_1.randomUUID)(),
            participantId: verified.participantId,
            projectId: verified.projectId,
            roomId: verified.roomId,
            permissions: verified.permissions,
            socket: client,
            joinedRoom: false,
            joinedAt: null,
            isAlive: true,
            messageTimestamps: [],
        };
        this.sessions.set(client, session);
        this.logger.log(`connection authenticated: participant=${session.participantId} room=${session.roomId}`);
        client.on('message', (data) => this.handleMessage(session, data));
        client.on('pong', () => {
            session.isAlive = true;
        });
        client.resume();
    }
    handleDisconnect(client) {
        const session = this.sessions.get(client);
        if (!session) {
            return;
        }
        this.sessions.delete(client);
        if (session.joinedRoom) {
            const result = this.messageRouter.route(session, { type: signaling_constants_1.ClientMessageType.ROOM_LEAVE });
            this.executeAction(session, result);
        }
        this.logger.log(`disconnected: participant=${session.participantId}`);
    }
    handleMessage(session, data) {
        const maxMessages = this.configService.get('signaling.maxMessagesPerWindow');
        const windowSeconds = this.configService.get('signaling.messageWindowSeconds');
        if (!(0, message_rate_limiter_util_1.checkMessageRate)(session, maxMessages, windowSeconds)) {
            this.sendMessage(session.socket, {
                type: signaling_constants_1.ServerMessageType.ERROR,
                code: signaling_constants_1.SignalingErrorCode.RATE_LIMITED,
                message: 'Too many messages — slow down',
            });
            return;
        }
        try {
            const message = this.messageValidator.parse(data);
            const result = this.messageRouter.route(session, message);
            this.executeAction(session, result);
        }
        catch (err) {
            if (err instanceof signaling_error_1.SignalingError) {
                this.sendMessage(session.socket, err.toMessage());
            }
            else {
                this.logger.error(`unexpected signaling error: ${err.message}`);
                this.sendMessage(session.socket, {
                    type: signaling_constants_1.ServerMessageType.ERROR,
                    code: signaling_constants_1.SignalingErrorCode.INVALID_MESSAGE,
                    message: 'Unable to process message',
                });
            }
        }
    }
    executeAction(session, result) {
        if (result.toSender) {
            this.sendMessage(session.socket, result.toSender);
        }
        for (const { session: target, message } of result.toOthers ?? []) {
            this.sendMessage(target.socket, message);
        }
        if (result.kick) {
            this.sendMessage(result.kick.socket, {
                type: signaling_constants_1.ServerMessageType.ERROR,
                code: signaling_constants_1.SignalingErrorCode.UNAUTHORIZED,
                message: 'This connection was replaced by a newer session for the same participant',
            });
            result.kick.socket.close(CLOSE_REPLACED, 'replaced');
        }
    }
    sendMessage(socket, message) {
        if (socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }
    runHeartbeat() {
        for (const [client, session] of this.sessions) {
            if (!session.isAlive) {
                this.logger.warn(`terminating stale connection: participant=${session.participantId}`);
                client.terminate();
                continue;
            }
            session.isAlive = false;
            client.ping();
        }
    }
    extractToken(request) {
        const url = new URL(request.url ?? '', 'http://localhost');
        return url.searchParams.get('token');
    }
    extractClientIp(request) {
        const forwarded = request.headers['x-forwarded-for'];
        if (typeof forwarded === 'string' && forwarded.length > 0) {
            return forwarded.split(',')[0].trim();
        }
        return request.socket.remoteAddress ?? 'unknown';
    }
    getMetrics() {
        return {
            activeConnections: this.sessions.size,
            ...this.roomRegistry.getMetrics(),
        };
    }
};
exports.SignalingGateway = SignalingGateway;
exports.SignalingGateway = SignalingGateway = SignalingGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({ path: signaling_constants_1.SIGNALING_PATH }),
    __metadata("design:paramtypes", [rtc_token_verifier_service_1.RtcTokenVerifierService,
        room_registry_service_1.RoomRegistryService,
        message_validator_service_1.MessageValidatorService,
        message_router_service_1.MessageRouterService,
        connection_rate_limit_service_1.ConnectionRateLimitService,
        config_1.ConfigService])
], SignalingGateway);
//# sourceMappingURL=signaling.gateway.js.map