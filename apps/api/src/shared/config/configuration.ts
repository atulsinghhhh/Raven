export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.API_PORT ?? '4000', 10),

  // Host-facing URL of this API, handed to RTC clients as `telemetryUrl`
  // alongside token/livekitUrl/iceServers — lets @raven/rtc POST telemetry
  // events without hardcoding an address in the SDK.
  publicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${parseInt(process.env.API_PORT ?? '4000', 10)}`,

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
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
