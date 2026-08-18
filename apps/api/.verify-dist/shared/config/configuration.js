"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.API_PORT ?? '4000', 10),
    publicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${parseInt(process.env.API_PORT ?? '4000', 10)}`,
    database: {
        url: process.env.DATABASE_URL,
    },
    redis: {
        url: process.env.REDIS_URL,
        commandTimeoutMs: parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS ?? '2000', 10),
    },
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    },
    livekit: {
        url: process.env.LIVEKIT_URL,
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
        internalUrl: process.env.LIVEKIT_INTERNAL_URL ?? 'http://livekit:7880',
    },
    rtcToken: {
        defaultTtlSeconds: parseInt(process.env.RTC_TOKEN_DEFAULT_TTL_SECONDS ?? '600', 10),
    },
    turn: {
        host: process.env.TURN_HOST ?? 'localhost',
        port: parseInt(process.env.TURN_PORT ?? '3478', 10),
        tlsPort: process.env.TURN_TLS_PORT ? parseInt(process.env.TURN_TLS_PORT, 10) : undefined,
        secret: process.env.TURN_SECRET,
        internalHost: process.env.TURN_INTERNAL_HOST ?? 'coturn',
    },
    apiKey: {
        pepper: process.env.API_KEY_HASH_SECRET,
    },
    cors: {
        origin: process.env.CORS_ORIGIN ?? '*',
    },
    rateLimit: {
        windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10),
    },
    signaling: {
        maxParticipantsPerRoom: parseInt(process.env.SIGNALING_MAX_PARTICIPANTS_PER_ROOM ?? '50', 10),
        maxMessageBytes: parseInt(process.env.SIGNALING_MAX_MESSAGE_BYTES ?? '16384', 10),
        maxMessagesPerWindow: parseInt(process.env.SIGNALING_MAX_MESSAGES_PER_WINDOW ?? '100', 10),
        messageWindowSeconds: parseInt(process.env.SIGNALING_MESSAGE_WINDOW_SECONDS ?? '10', 10),
        maxConnectionsPerWindow: parseInt(process.env.SIGNALING_MAX_CONNECTIONS_PER_WINDOW ?? '20', 10),
    },
    chat: {
        tokenSecret: process.env.CHAT_TOKEN_SECRET ?? process.env.JWT_SECRET,
        tokenDefaultTtlSeconds: parseInt(process.env.CHAT_TOKEN_DEFAULT_TTL_SECONDS ?? '3600', 10),
        tokenMaxTtlSeconds: parseInt(process.env.CHAT_TOKEN_MAX_TTL_SECONDS ?? String(6 * 60 * 60), 10),
        maxTextLength: parseInt(process.env.CHAT_MAX_TEXT_LENGTH ?? '4000', 10),
        maxMetadataBytes: parseInt(process.env.CHAT_MAX_METADATA_BYTES ?? '4096', 10),
        maxFrameBytes: parseInt(process.env.CHAT_MAX_FRAME_BYTES ?? '65536', 10),
        maxReactionsPerMessage: parseInt(process.env.CHAT_MAX_REACTIONS_PER_MESSAGE ?? '200', 10),
        maxRoomSubscriptionsPerConnection: parseInt(process.env.CHAT_MAX_ROOM_SUBSCRIPTIONS ?? '20', 10),
        maxHistoryPageSize: parseInt(process.env.CHAT_MAX_HISTORY_PAGE_SIZE ?? '100', 10),
        sendRateLimit: parseInt(process.env.CHAT_SEND_RATE_LIMIT ?? '30', 10),
        sendRateWindowSeconds: parseInt(process.env.CHAT_SEND_RATE_WINDOW_SECONDS ?? '10', 10),
        reactionRateLimit: parseInt(process.env.CHAT_REACTION_RATE_LIMIT ?? '60', 10),
        typingRateLimit: parseInt(process.env.CHAT_TYPING_RATE_LIMIT ?? '20', 10),
        subscribeRateLimit: parseInt(process.env.CHAT_SUBSCRIBE_RATE_LIMIT ?? '60', 10),
        connectionRateLimit: parseInt(process.env.CHAT_CONNECTION_RATE_LIMIT ?? '30', 10),
        presenceTtlSeconds: parseInt(process.env.CHAT_PRESENCE_TTL_SECONDS ?? '45', 10),
        typingTtlSeconds: parseInt(process.env.CHAT_TYPING_TTL_SECONDS ?? '7', 10),
        retentionDays: parseInt(process.env.CHAT_RETENTION_DAYS ?? '0', 10),
        retentionSweepIntervalMs: parseInt(process.env.CHAT_RETENTION_SWEEP_INTERVAL_MS ?? String(6 * 60 * 60 * 1000), 10),
    },
    webhooks: {
        maxAttempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '6', 10),
        backoffBaseMs: parseInt(process.env.WEBHOOK_BACKOFF_BASE_MS ?? '10000', 10),
        timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
        pollIntervalMs: parseInt(process.env.WEBHOOK_POLL_INTERVAL_MS ?? '2000', 10),
        batchSize: parseInt(process.env.WEBHOOK_BATCH_SIZE ?? '20', 10),
        disableAfterConsecutiveFailures: parseInt(process.env.WEBHOOK_DISABLE_AFTER_FAILURES ?? '50', 10),
    },
    storage: {
        endpoint: process.env.STORAGE_ENDPOINT,
        region: process.env.STORAGE_REGION ?? 'us-east-1',
        bucket: process.env.STORAGE_BUCKET,
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
        forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
        uploadUrlTtlSeconds: parseInt(process.env.STORAGE_UPLOAD_URL_TTL_SECONDS ?? '900', 10),
        downloadUrlTtlSeconds: parseInt(process.env.STORAGE_DOWNLOAD_URL_TTL_SECONDS ?? '900', 10),
        maxAttachmentBytes: parseInt(process.env.STORAGE_MAX_ATTACHMENT_BYTES ?? String(25 * 1024 * 1024), 10),
    },
    observability: {
        connectionRetentionDays: parseInt(process.env.OBSERVABILITY_CONNECTION_RETENTION_DAYS ?? '30', 10),
        errorRetentionDays: parseInt(process.env.OBSERVABILITY_ERROR_RETENTION_DAYS ?? '30', 10),
        retentionSweepIntervalMs: parseInt(process.env.OBSERVABILITY_RETENTION_SWEEP_INTERVAL_MS ?? String(60 * 60 * 1000), 10),
    },
});
//# sourceMappingURL=configuration.js.map