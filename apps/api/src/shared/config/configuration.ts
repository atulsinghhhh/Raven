export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.API_PORT ?? '4000', 10),

  // Host-facing URL of this API, handed to RTC clients as `telemetryUrl`
  // alongside token/livekitUrl/iceServers — lets @corvidhq/rtc POST telemetry
  // events without hardcoding an address in the SDK.
  publicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${parseInt(process.env.API_PORT ?? '4000', 10)}`,

  database: {
    url: process.env.DATABASE_URL,
    // pg.Pool sizing (read directly from env in prisma.service.ts, same
    // as `url` above — see that file's comment on why this one config
    // key bypasses ConfigService). Documented here anyway, for the same
    // reason `url` is: one place listing every env-driven knob.
    //
    // Every pod's pool competes for the same Postgres max_connections —
    // this is the real ceiling on horizontal API scaling. N pods × this
    // value must stay comfortably under Postgres's max_connections minus
    // headroom for migrations/admin connections; see
    // docs/production/capacity-report.md for the measured sizing. A
    // PgBouncer (transaction mode) in front of Postgres is the
    // recommended production topology once pod count makes N × poolMax
    // approach that ceiling — see infrastructure/k8s.
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
    poolIdleTimeoutMs: parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
    poolConnectionTimeoutMs: parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? '5000', 10),
  },

  redis: {
    url: process.env.REDIS_URL,
    // Upper bound on a single Redis command. Exists so a hung Redis
    // (partition, paused container) surfaces as an error the callers can
    // fail open on, rather than an unbounded wait — see redis.service.ts.
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
    // Container-to-container address, separate from `url` above (which is
    // host-facing, for real clients). The API runs inside the Docker
    // network too, so its own server calls (RoomServiceClient, /health)
    // need LiveKit's Docker service name — "localhost" here would just
    // point back at the api container itself.
    internalUrl: process.env.LIVEKIT_INTERNAL_URL ?? 'http://livekit:7880',
  },

  rtcToken: {
    defaultTtlSeconds: parseInt(process.env.RTC_TOKEN_DEFAULT_TTL_SECONDS ?? '600', 10),
  },

  turn: {
    // Host-facing, same story as LIVEKIT_URL above — this is what a real
    // client gets back, not the internal Docker address.
    host: process.env.TURN_HOST ?? 'localhost',
    port: parseInt(process.env.TURN_PORT ?? '3478', 10),
    // Only advertised as a turns: ICE server when set. Leave unset if
    // coturn has no TLS cert configured.
    tlsPort: process.env.TURN_TLS_PORT ? parseInt(process.env.TURN_TLS_PORT, 10) : undefined,
    secret: process.env.TURN_SECRET,
    // Same deal as livekit.internalUrl — the STUN health check runs inside
    // the api container and needs coturn's Docker service name here, not
    // the host-facing TURN_HOST.
    internalHost: process.env.TURN_INTERNAL_HOST ?? 'coturn',
  },

  apiKey: {
    // Pepper mixed into the secret before hashing. The per-key bcrypt salt
    // lives in the hash itself (in the DB); this pepper lives only in env
    // config, so a DB leak alone isn't enough to brute-force key secrets.
    pepper: process.env.API_KEY_HASH_SECRET,
  },

  cors: {
    // Comma-separated allowed origins, or "*" for local dev only —
    // don't ship "*" to production.
    origin: process.env.CORS_ORIGIN ?? '*',
  },

  rateLimit: {
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10),
  },

  signaling: {
    maxParticipantsPerRoom: parseInt(process.env.SIGNALING_MAX_PARTICIPANTS_PER_ROOM ?? '50', 10),
    maxMessageBytes: parseInt(process.env.SIGNALING_MAX_MESSAGE_BYTES ?? '16384', 10),
    // Per-connection message rate limit, in-memory sliding window — no
    // Redis needed for this one.
    maxMessagesPerWindow: parseInt(process.env.SIGNALING_MAX_MESSAGES_PER_WINDOW ?? '100', 10),
    messageWindowSeconds: parseInt(process.env.SIGNALING_MESSAGE_WINDOW_SECONDS ?? '10', 10),
    // Connection attempts per client IP. This one IS Redis-backed (shares
    // the HTTP API's limiter) since it's guarding the upgrade handshake,
    // not throughput on an already-established connection.
    maxConnectionsPerWindow: parseInt(process.env.SIGNALING_MAX_CONNECTIONS_PER_WINDOW ?? '20', 10),
  },

  chat: {
    // Chat tokens are signed with their own secret, never JWT_SECRET.
    // A leaked dashboard-session secret must not be able to mint a chat
    // token, and vice versa. Falls back to JWT_SECRET only so local dev
    // works out of the box after a `git pull` — production validation
    // (env.validation.ts) rejects that.
    tokenSecret: process.env.CHAT_TOKEN_SECRET ?? process.env.JWT_SECRET,
    tokenDefaultTtlSeconds: parseInt(process.env.CHAT_TOKEN_DEFAULT_TTL_SECONDS ?? '3600', 10),
    tokenMaxTtlSeconds: parseInt(process.env.CHAT_TOKEN_MAX_TTL_SECONDS ?? String(6 * 60 * 60), 10),

    // Payload ceilings (spec §38). Enforced identically on the WebSocket
    // and the HTTP path — a limit only one transport honours isn't a limit.
    maxTextLength: parseInt(process.env.CHAT_MAX_TEXT_LENGTH ?? '4000', 10),
    maxMetadataBytes: parseInt(process.env.CHAT_MAX_METADATA_BYTES ?? '4096', 10),
    maxFrameBytes: parseInt(process.env.CHAT_MAX_FRAME_BYTES ?? '65536', 10),
    maxReactionsPerMessage: parseInt(process.env.CHAT_MAX_REACTIONS_PER_MESSAGE ?? '200', 10),
    maxRoomSubscriptionsPerConnection: parseInt(process.env.CHAT_MAX_ROOM_SUBSCRIPTIONS ?? '20', 10),
    maxHistoryPageSize: parseInt(process.env.CHAT_MAX_HISTORY_PAGE_SIZE ?? '100', 10),

    // Per-user sliding budgets, Redis-backed so they hold across gateway
    // instances (unlike the RTC signaling limiter, which is per-socket).
    sendRateLimit: parseInt(process.env.CHAT_SEND_RATE_LIMIT ?? '30', 10),
    sendRateWindowSeconds: parseInt(process.env.CHAT_SEND_RATE_WINDOW_SECONDS ?? '10', 10),
    reactionRateLimit: parseInt(process.env.CHAT_REACTION_RATE_LIMIT ?? '60', 10),
    typingRateLimit: parseInt(process.env.CHAT_TYPING_RATE_LIMIT ?? '20', 10),
    subscribeRateLimit: parseInt(process.env.CHAT_SUBSCRIBE_RATE_LIMIT ?? '60', 10),
    connectionRateLimit: parseInt(process.env.CHAT_CONNECTION_RATE_LIMIT ?? '30', 10),

    // Ephemeral-state TTLs. presenceTtl has to outlive a heartbeat cycle
    // or a healthy connection would flap offline between pings.
    presenceTtlSeconds: parseInt(process.env.CHAT_PRESENCE_TTL_SECONDS ?? '45', 10),
    typingTtlSeconds: parseInt(process.env.CHAT_TYPING_TTL_SECONDS ?? '7', 10),

    // Default message retention, overridable per conversation. 0 = keep
    // forever. The sweeper only runs when this (or a conversation
    // override) is set — see docs/chat/overview.md#retention.
    retentionDays: parseInt(process.env.CHAT_RETENTION_DAYS ?? '0', 10),
    retentionSweepIntervalMs: parseInt(
      process.env.CHAT_RETENTION_SWEEP_INTERVAL_MS ?? String(6 * 60 * 60 * 1000),
      10,
    ),
  },

  webhooks: {
    maxAttempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '6', 10),
    // Base for the exponential backoff: 10s, 20s, 40s, 80s, 160s, 320s.
    backoffBaseMs: parseInt(process.env.WEBHOOK_BACKOFF_BASE_MS ?? '10000', 10),
    timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
    // How often the delivery worker looks for due deliveries. Off the
    // message hot path entirely (spec §32).
    pollIntervalMs: parseInt(process.env.WEBHOOK_POLL_INTERVAL_MS ?? '2000', 10),
    batchSize: parseInt(process.env.WEBHOOK_BATCH_SIZE ?? '20', 10),
    // An endpoint that fails this many deliveries in a row gets disabled
    // so a dead URL stops burning retry budget forever.
    disableAfterConsecutiveFailures: parseInt(process.env.WEBHOOK_DISABLE_AFTER_FAILURES ?? '50', 10),
  },

  storage: {
    // S3-compatible object storage for chat attachments (MinIO locally,
    // S3/R2/Spaces in production). Unset bucket = attachments disabled,
    // and the API says so explicitly rather than half-working.
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    bucket: process.env.STORAGE_BUCKET,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    // MinIO needs path-style (http://host/bucket/key); real S3 prefers
    // virtual-host style.
    forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
    uploadUrlTtlSeconds: parseInt(process.env.STORAGE_UPLOAD_URL_TTL_SECONDS ?? '900', 10),
    downloadUrlTtlSeconds: parseInt(process.env.STORAGE_DOWNLOAD_URL_TTL_SECONDS ?? '900', 10),
    maxAttachmentBytes: parseInt(process.env.STORAGE_MAX_ATTACHMENT_BYTES ?? String(25 * 1024 * 1024), 10),
  },

  logging: {
    // pino level name (trace/debug/info/warn/error/fatal), not a Nest
    // ConsoleLogger level — see shared/redis/redis.service.ts's comment
    // style: this is the one knob that varies by deployment; the JSON
    // shape/fields themselves are fixed (main.ts, nativeLoggerOptions).
    level: process.env.LOG_LEVEL ?? 'info',
  },

  observability: {
    // Retention defaults, swept by RetentionService on an interval rather
    // than a cron job so we don't pull in a new scheduling dependency.
    connectionRetentionDays: parseInt(process.env.OBSERVABILITY_CONNECTION_RETENTION_DAYS ?? '30', 10),
    errorRetentionDays: parseInt(process.env.OBSERVABILITY_ERROR_RETENTION_DAYS ?? '30', 10),
    retentionSweepIntervalMs: parseInt(
      process.env.OBSERVABILITY_RETENTION_SWEEP_INTERVAL_MS ?? String(60 * 60 * 1000),
      10,
    ),
  },
});
