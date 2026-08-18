export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.API_PORT ?? '4000', 10),

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
    // Container-to-container address, deliberately distinct from `url`
    // above (which is host-facing, for real clients). The API process
    // itself runs inside the Docker network, so its own server-to-server
    // calls (RoomServiceClient, /health) must use LiveKit's Docker service
    // name — "localhost" from inside the api container is the api
    // container itself, not LiveKit. See docs/dashboard.md#health.
    internalUrl: process.env.LIVEKIT_INTERNAL_URL ?? 'http://livekit:7880',
  },

  rtcToken: {
    defaultTtlSeconds: parseInt(process.env.RTC_TOKEN_DEFAULT_TTL_SECONDS ?? '600', 10),
  },

  turn: {
    // Host-facing values, deliberately distinct from the internal
    // Docker network — this is what's returned to a real client, same
    // reasoning as LIVEKIT_URL. See docs/architecture/turn.md and
    // docs/sfu.md#turn-integration.
    host: process.env.TURN_HOST ?? 'localhost',
    port: parseInt(process.env.TURN_PORT ?? '3478', 10),
    // Optional: only advertised (as a turns: ICE server) when set. A
    // deployment without a TLS cert configured on coturn should leave
    // this unset — see docs/turn.md#tls.
    tlsPort: process.env.TURN_TLS_PORT ? parseInt(process.env.TURN_TLS_PORT, 10) : undefined,
    secret: process.env.TURN_SECRET,
    // Same reasoning as livekit.internalUrl above — the STUN health check
    // runs from inside the api container and must reach coturn's Docker
    // service name, not the host-facing TURN_HOST.
    internalHost: process.env.TURN_INTERNAL_HOST ?? 'coturn',
  },

  apiKey: {
    // A pepper added to the secret before hashing. Unlike the per-key
    // bcrypt salt (which lives in the hash itself, in the database), the
    // pepper lives only in environment config — so a database-only
    // compromise (dump, backup leak) isn't enough by itself to brute-force
    // API key secrets offline.
    pepper: process.env.API_KEY_HASH_SECRET,
  },

  cors: {
    // Comma-separated list of allowed origins, or "*" for local dev.
    // Never use "*" in production — see docs/control-plane.md#cors.
    origin: process.env.CORS_ORIGIN ?? '*',
  },

  rateLimit: {
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10),
  },

  signaling: {
    maxParticipantsPerRoom: parseInt(process.env.SIGNALING_MAX_PARTICIPANTS_PER_ROOM ?? '50', 10),
    maxMessageBytes: parseInt(process.env.SIGNALING_MAX_MESSAGE_BYTES ?? '16384', 10),
    // Per-connection message rate limit (in-memory sliding window — see
    // docs/signaling.md#rate-limiting for why this doesn't need Redis).
    maxMessagesPerWindow: parseInt(process.env.SIGNALING_MAX_MESSAGES_PER_WINDOW ?? '100', 10),
    messageWindowSeconds: parseInt(process.env.SIGNALING_MESSAGE_WINDOW_SECONDS ?? '10', 10),
    // Connection attempts per client IP — this one IS Redis-backed
    // (shared with the HTTP API's rate limiter) since it protects the
    // upgrade handshake, not an established connection's throughput.
    maxConnectionsPerWindow: parseInt(process.env.SIGNALING_MAX_CONNECTIONS_PER_WINDOW ?? '20', 10),
  },
});
