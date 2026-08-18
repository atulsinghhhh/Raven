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
var ChatGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatGateway = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const websockets_1 = require("@nestjs/websockets");
const ws_1 = require("ws");
const crypto_util_1 = require("../../../shared/utils/crypto.util");
const chat_error_1 = require("../chat-error");
const chat_constants_1 = require("../chat.constants");
const conversations_service_1 = require("../conversations/conversations.service");
const chat_metrics_service_1 = require("../metrics/chat-metrics.service");
const messages_service_1 = require("../messages/messages.service");
const presence_service_1 = require("../presence/presence.service");
const reactions_service_1 = require("../reactions/reactions.service");
const read_state_service_1 = require("../read-state/read-state.service");
const chat_rate_limit_service_1 = require("../rate-limit/chat-rate-limit.service");
const chat_events_service_1 = require("../realtime/chat-events.service");
const chat_token_service_1 = require("../tokens/chat-token.service");
const typing_service_1 = require("../typing/typing.service");
const connection_registry_service_1 = require("./connection-registry.service");
const chat_frame_validator_1 = require("./chat-frame.validator");
let ChatGateway = ChatGateway_1 = class ChatGateway {
    constructor(chatTokens, conversations, messages, reactions, readState, presence, typing, events, rateLimit, metrics, registry, configService) {
        this.chatTokens = chatTokens;
        this.conversations = conversations;
        this.messages = messages;
        this.reactions = reactions;
        this.readState = readState;
        this.presence = presence;
        this.typing = typing;
        this.events = events;
        this.rateLimit = rateLimit;
        this.metrics = metrics;
        this.registry = registry;
        this.configService = configService;
        this.logger = new common_1.Logger(ChatGateway_1.name);
        this.sessions = new Map();
        this.roomIndex = new Map();
    }
    afterInit() {
        this.unsubscribeFromEvents = this.events.onEvent((envelope) => this.deliverToLocalSockets(envelope));
        this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), chat_constants_1.CHAT_HEARTBEAT_INTERVAL_MS);
        this.heartbeatTimer.unref?.();
        this.logger.log(`Chat gateway ${this.registry.gatewayId} listening on ${chat_constants_1.CHAT_PATH}`);
    }
    async onModuleDestroy() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        this.unsubscribeFromEvents?.();
        for (const [socket, session] of this.sessions) {
            await this.teardownSession(session, 'server_shutdown');
            socket.close(chat_constants_1.CHAT_CLOSE_SERVER_SHUTDOWN, 'server shutting down');
        }
        this.sessions.clear();
        this.roomIndex.clear();
    }
    async handleConnection(socket, request) {
        socket.pause();
        const clientIp = extractClientIp(request);
        if (!this.isOriginAllowed(request)) {
            this.logger.warn(`chat connection rejected: disallowed origin from ${clientIp}`);
            this.rejectConnection(socket, new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.ORIGIN_NOT_ALLOWED, 'This origin is not allowed to open a chat connection'), chat_constants_1.CHAT_CLOSE_FORBIDDEN);
            return;
        }
        try {
            await this.rateLimit.consume('connect', 'global', clientIp);
        }
        catch (err) {
            this.metrics.increment('global', 'connections_failed');
            this.rejectConnection(socket, err, chat_constants_1.CHAT_CLOSE_RATE_LIMITED);
            return;
        }
        let claims;
        try {
            claims = await this.chatTokens.verify(extractToken(request) ?? '');
        }
        catch (err) {
            const chatError = err instanceof chat_error_1.ChatError ? err : new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_TOKEN, 'Authentication failed');
            this.logger.warn(`chat authentication rejected from ${clientIp}: ${chatError.chatCode}`);
            this.rejectConnection(socket, chatError, chatError.chatCode === chat_constants_1.ChatErrorCode.TOKEN_EXPIRED ? chat_constants_1.CHAT_CLOSE_TOKEN_EXPIRED : chat_constants_1.CHAT_CLOSE_AUTH_FAILED);
            return;
        }
        const connectionId = (0, crypto_util_1.generateId)('ccn');
        const session = {
            connectionId,
            projectId: claims.pid,
            userId: claims.sub,
            scopes: claims.scopes,
            tokenId: claims.jti,
            tokenExpiresAt: claims.exp * 1000,
            conversationScope: claims.cvs ?? [],
            socket,
            rooms: new Map(),
            isAlive: true,
            connectedAt: new Date(),
            messagesSent: 0,
        };
        session.connectionRowId = await this.registry.register({
            connectionId,
            projectId: session.projectId,
            userId: session.userId,
            sdkVersion: extractQueryParam(request, 'sdkVersion'),
            platform: extractQueryParam(request, 'platform'),
        });
        this.sessions.set(socket, session);
        this.metrics.increment(session.projectId, 'connections_opened');
        socket.on('message', (data) => void this.handleFrame(session, data));
        socket.on('pong', () => {
            session.isAlive = true;
        });
        socket.on('error', (err) => {
            this.logger.warn(`chat socket error on ${connectionId}: ${err.message}`);
        });
        this.send(socket, {
            type: chat_constants_1.ChatServerFrame.CONNECTED,
            connectionId,
            userId: session.userId,
            scopes: session.scopes,
            expiresAt: new Date(session.tokenExpiresAt).toISOString(),
            heartbeatIntervalMs: chat_constants_1.CHAT_HEARTBEAT_INTERVAL_MS,
        });
        socket.resume();
        this.logger.log(`chat connected: ${connectionId} user=${session.userId}`);
    }
    async handleDisconnect(socket) {
        const session = this.sessions.get(socket);
        if (!session)
            return;
        this.sessions.delete(socket);
        await this.teardownSession(session, 'client_disconnected');
        this.logger.log(`chat disconnected: ${session.connectionId} user=${session.userId}`);
    }
    async teardownSession(session, reason) {
        for (const [conversationId, subscription] of session.rooms) {
            this.removeFromRoomIndex(conversationId, session.socket);
            await subscription.unsubscribe();
            await this.presence.clear(session.projectId, conversationId, subscription.conversationPublicId, session.userId);
            await this.typing.stop(session.projectId, conversationId, subscription.conversationPublicId, session.userId, session.connectionId);
        }
        session.rooms.clear();
        await this.registry.unregister({
            connectionId: session.connectionId,
            connectionRowId: session.connectionRowId,
            projectId: session.projectId,
            userId: session.userId,
            connectedAt: session.connectedAt,
            messagesSent: session.messagesSent,
            reason,
        });
    }
    async handleFrame(session, data) {
        let frame;
        try {
            frame = (0, chat_frame_validator_1.parseClientFrame)(data, this.configService.get('chat.maxFrameBytes'));
            await this.dispatch(session, frame);
        }
        catch (err) {
            this.replyWithError(session, err, frame?.id);
        }
    }
    async dispatch(session, frame) {
        switch (frame.type) {
            case chat_constants_1.ChatClientFrame.PING:
                this.send(session.socket, { type: chat_constants_1.ChatServerFrame.PONG, id: frame.id });
                return;
            case chat_constants_1.ChatClientFrame.ROOM_JOIN:
                return this.handleRoomJoin(session, frame);
            case chat_constants_1.ChatClientFrame.ROOM_LEAVE:
                return this.handleRoomLeave(session, frame);
            case chat_constants_1.ChatClientFrame.MESSAGE_SEND:
                return this.handleSend(session, frame);
            case chat_constants_1.ChatClientFrame.MESSAGE_UPDATE: {
                const message = await this.messages.update(this.actorFor(session), (0, chat_frame_validator_1.requireString)(frame, 'messageId', 64), {
                    text: (0, chat_frame_validator_1.optionalString)(frame, 'text', 100_000),
                });
                this.ack(session, frame.id, message);
                return;
            }
            case chat_constants_1.ChatClientFrame.MESSAGE_DELETE: {
                const message = await this.messages.delete(this.actorFor(session), (0, chat_frame_validator_1.requireString)(frame, 'messageId', 64));
                this.ack(session, frame.id, { id: message.id, deletedAt: message.deletedAt });
                return;
            }
            case chat_constants_1.ChatClientFrame.REACTION_ADD: {
                const result = await this.reactions.add(this.actorFor(session), (0, chat_frame_validator_1.requireString)(frame, 'messageId', 64), (0, chat_frame_validator_1.requireString)(frame, 'emoji', 32));
                this.ack(session, frame.id, result);
                return;
            }
            case chat_constants_1.ChatClientFrame.REACTION_REMOVE: {
                const result = await this.reactions.remove(this.actorFor(session), (0, chat_frame_validator_1.requireString)(frame, 'messageId', 64), (0, chat_frame_validator_1.requireString)(frame, 'emoji', 32));
                this.ack(session, frame.id, result);
                return;
            }
            case chat_constants_1.ChatClientFrame.TYPING_START:
            case chat_constants_1.ChatClientFrame.TYPING_STOP:
                return this.handleTyping(session, frame);
            case chat_constants_1.ChatClientFrame.READ_MARK: {
                const state = await this.readState.markRead(this.actorFor(session), (0, chat_frame_validator_1.requireString)(frame, 'messageId', 64));
                this.ack(session, frame.id, state);
                return;
            }
            case chat_constants_1.ChatClientFrame.PRESENCE_SET:
                return this.handlePresenceSet(session, frame);
            default:
                throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE_TYPE, 'Unsupported frame type');
        }
    }
    async handleRoomJoin(session, frame) {
        const reference = (0, chat_frame_validator_1.requireString)(frame, 'room', 128);
        await this.rateLimit.consume('subscribe', session.projectId, session.userId);
        const maxRooms = this.configService.get('chat.maxRoomSubscriptionsPerConnection');
        if (session.rooms.size >= maxRooms) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.TOO_MANY_SUBSCRIPTIONS, `A connection may subscribe to at most ${maxRooms} rooms`);
        }
        const { conversation } = await this.conversations.authorize(this.actorFor(session), reference);
        if (session.rooms.has(conversation.id)) {
            this.ack(session, frame.id, { room: conversation.publicId, alreadyJoined: true });
            return;
        }
        const unsubscribe = await this.events.subscribe(session.projectId, conversation.id);
        const subscription = {
            conversationId: conversation.id,
            conversationPublicId: conversation.publicId,
            unsubscribe,
        };
        session.rooms.set(conversation.id, subscription);
        this.addToRoomIndex(conversation.id, session.socket);
        await this.presence.set(session.projectId, conversation.id, conversation.publicId, session.userId, chat_constants_1.PresenceStatus.ONLINE);
        const [present, typingUsers] = await Promise.all([
            this.presence.list(session.projectId, conversation.id).catch(() => []),
            this.typing.list(session.projectId, conversation.id),
        ]);
        this.send(session.socket, {
            type: chat_constants_1.ChatServerFrame.ROOM_JOINED,
            id: frame.id,
            room: conversation.publicId,
            name: conversation.name,
            presence: present,
            typing: typingUsers,
        });
    }
    async handleRoomLeave(session, frame) {
        const reference = (0, chat_frame_validator_1.requireString)(frame, 'room', 128);
        const { conversation } = await this.conversations.authorize(this.actorFor(session), reference);
        const subscription = session.rooms.get(conversation.id);
        if (!subscription) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.NOT_IN_ROOM, 'This connection is not subscribed to that room');
        }
        session.rooms.delete(conversation.id);
        this.removeFromRoomIndex(conversation.id, session.socket);
        await subscription.unsubscribe();
        await this.presence.clear(session.projectId, conversation.id, conversation.publicId, session.userId);
        await this.typing.stop(session.projectId, conversation.id, conversation.publicId, session.userId, session.connectionId);
        this.send(session.socket, { type: chat_constants_1.ChatServerFrame.ROOM_LEFT, id: frame.id, room: conversation.publicId });
    }
    async handleSend(session, frame) {
        const room = (0, chat_frame_validator_1.requireString)(frame, 'room', 128);
        const receivedAt = Date.now();
        const result = await this.messages.send(this.actorFor(session), room, {
            text: (0, chat_frame_validator_1.optionalString)(frame, 'text', 100_000),
            type: (0, chat_frame_validator_1.optionalString)(frame, 'messageType', 32),
            replyTo: (0, chat_frame_validator_1.optionalString)(frame, 'replyTo', 64),
            clientMessageId: (0, chat_frame_validator_1.optionalString)(frame, 'clientMessageId', 128),
            attachmentId: (0, chat_frame_validator_1.optionalString)(frame, 'attachmentId', 64),
            metadata: frame.metadata ?? undefined,
            clientSentAt: typeof frame.clientSentAt === 'number' ? frame.clientSentAt : undefined,
        }, session.connectionId);
        session.messagesSent += 1;
        this.ack(session, frame.id, {
            message: result.message,
            deduplicated: result.deduplicated,
            status: 'stored',
            persistLatencyMs: result.persistLatencyMs,
            serverReceivedAt: new Date(receivedAt).toISOString(),
        });
    }
    async handleTyping(session, frame) {
        const reference = (0, chat_frame_validator_1.requireString)(frame, 'room', 128);
        const { conversation } = await this.conversations.authorize(this.actorFor(session), reference);
        await this.rateLimit.consume('typing', session.projectId, session.userId);
        if (frame.type === chat_constants_1.ChatClientFrame.TYPING_START) {
            await this.typing.start(session.projectId, conversation.id, conversation.publicId, session.userId, session.connectionId);
        }
        else {
            await this.typing.stop(session.projectId, conversation.id, conversation.publicId, session.userId, session.connectionId);
        }
        if (frame.id) {
            this.ack(session, frame.id, { room: conversation.publicId });
        }
    }
    async handlePresenceSet(session, frame) {
        const status = (0, chat_frame_validator_1.requireString)(frame, 'status', 16);
        if (!Object.values(chat_constants_1.PresenceStatus).includes(status)) {
            throw new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INVALID_MESSAGE, 'status must be one of: online, away, offline');
        }
        for (const [conversationId, subscription] of session.rooms) {
            await this.presence.set(session.projectId, conversationId, subscription.conversationPublicId, session.userId, status);
        }
        if (frame.id) {
            this.ack(session, frame.id, { status });
        }
    }
    deliverToLocalSockets(envelope) {
        const { event } = envelope;
        const sockets = this.roomIndex.get(event.conversationId);
        if (!sockets || sockets.size === 0) {
            return;
        }
        const skipOrigin = event.type === chat_constants_1.ChatServerFrame.TYPING_STARTED ||
            event.type === chat_constants_1.ChatServerFrame.TYPING_STOPPED ||
            event.type === chat_constants_1.ChatServerFrame.PRESENCE;
        const { conversationId: _internal, ...clientEvent } = event;
        let delivered = 0;
        for (const socket of sockets) {
            const session = this.sessions.get(socket);
            if (!session)
                continue;
            if (skipOrigin && envelope.originConnectionId === session.connectionId)
                continue;
            this.send(socket, clientEvent);
            delivered += 1;
        }
        if (delivered > 0 && event.type === chat_constants_1.ChatServerFrame.MESSAGE) {
            this.metrics.increment(envelope.projectId, 'messages_fanned_out', delivered);
            this.metrics.recordLatency(envelope.projectId, 'fanout', Date.now() - envelope.publishedAt);
        }
    }
    addToRoomIndex(conversationId, socket) {
        const sockets = this.roomIndex.get(conversationId);
        if (sockets) {
            sockets.add(socket);
        }
        else {
            this.roomIndex.set(conversationId, new Set([socket]));
        }
    }
    removeFromRoomIndex(conversationId, socket) {
        const sockets = this.roomIndex.get(conversationId);
        if (!sockets)
            return;
        sockets.delete(socket);
        if (sockets.size === 0) {
            this.roomIndex.delete(conversationId);
        }
    }
    async runHeartbeat() {
        const now = Date.now();
        for (const [socket, session] of this.sessions) {
            if (!session.isAlive) {
                this.logger.warn(`terminating unresponsive chat connection ${session.connectionId}`);
                await this.teardownSession(session, 'heartbeat_timeout');
                this.sessions.delete(socket);
                socket.terminate();
                continue;
            }
            if (session.tokenExpiresAt <= now) {
                this.logger.log(`closing chat connection ${session.connectionId}: token expired`);
                this.send(socket, new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.TOKEN_EXPIRED, 'Chat token expired — reconnect with a new one').toFrame());
                await this.teardownSession(session, 'token_expired');
                this.sessions.delete(socket);
                socket.close(chat_constants_1.CHAT_CLOSE_TOKEN_EXPIRED, 'token expired');
                continue;
            }
            session.isAlive = false;
            socket.ping();
            await this.registry.touch(session.connectionId, session.projectId, session.userId);
            for (const [conversationId, subscription] of session.rooms) {
                await this.presence.set(session.projectId, conversationId, subscription.conversationPublicId, session.userId, chat_constants_1.PresenceStatus.ONLINE);
            }
        }
    }
    actorFor(session) {
        return {
            kind: 'client',
            projectId: session.projectId,
            userId: session.userId,
            scopes: session.scopes,
            tokenId: session.tokenId,
            conversationScope: session.conversationScope,
        };
    }
    ack(session, id, data) {
        this.send(session.socket, { type: chat_constants_1.ChatServerFrame.ACK, id, ok: true, data });
    }
    replyWithError(session, err, correlationId) {
        if (err instanceof chat_error_1.ChatError) {
            if (err.chatCode === chat_constants_1.ChatErrorCode.RATE_LIMITED) {
                this.metrics.increment(session.projectId, 'rate_limited');
            }
            this.send(session.socket, err.toFrame(correlationId));
            return;
        }
        this.logger.error(`unhandled chat frame error: ${err?.message}`, err?.stack);
        this.metrics.increment(session.projectId, 'messages_failed');
        this.send(session.socket, new chat_error_1.ChatError(chat_constants_1.ChatErrorCode.INTERNAL_ERROR, 'Could not process that request').toFrame(correlationId));
    }
    send(socket, payload) {
        if (socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(JSON.stringify(payload));
        }
    }
    rejectConnection(socket, error, closeCode) {
        this.send(socket, error.toFrame());
        socket.resume();
        socket.close(closeCode, error.chatCode);
    }
    isOriginAllowed(request) {
        const configured = this.configService.get('cors.origin');
        if (configured === '*') {
            return true;
        }
        const origin = request.headers.origin;
        if (!origin) {
            return true;
        }
        return configured
            .split(',')
            .map((allowed) => allowed.trim())
            .includes(origin);
    }
    getMetrics() {
        return {
            gatewayId: this.registry.gatewayId,
            activeConnections: this.sessions.size,
            subscribedRooms: this.roomIndex.size,
            subscribedChannels: this.events.getSubscribedChannelCount(),
        };
    }
};
exports.ChatGateway = ChatGateway;
exports.ChatGateway = ChatGateway = ChatGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({ path: chat_constants_1.CHAT_PATH }),
    __metadata("design:paramtypes", [chat_token_service_1.ChatTokenService,
        conversations_service_1.ConversationsService,
        messages_service_1.MessagesService,
        reactions_service_1.ReactionsService,
        read_state_service_1.ReadStateService,
        presence_service_1.PresenceService,
        typing_service_1.TypingService,
        chat_events_service_1.ChatEventsService,
        chat_rate_limit_service_1.ChatRateLimitService,
        chat_metrics_service_1.ChatMetricsService,
        connection_registry_service_1.ConnectionRegistryService,
        config_1.ConfigService])
], ChatGateway);
function extractToken(request) {
    const url = new URL(request.url ?? '', 'http://localhost');
    return url.searchParams.get('token');
}
function extractQueryParam(request, name) {
    const url = new URL(request.url ?? '', 'http://localhost');
    return url.searchParams.get(name) ?? undefined;
}
function extractClientIp(request) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return request.socket.remoteAddress ?? 'unknown';
}
//# sourceMappingURL=chat.gateway.js.map