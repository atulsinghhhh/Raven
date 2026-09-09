export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.API_PORT ?? '4000', 10),

  // Host-facing URL of this API. Handed to RTC clients as `telemetryUrl`
  // next to token/endpoint/iceServers, so @ravenkash/rtc can POST telemetry
  // events without an address hardcoded into the SDK.
  publicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${parseInt(process.env.API_PORT ?? '4000', 10)}`,

  // Where a *person* ends up when they follow a link we sent them: the
  // dashboard, not this API. Every email link, verification and password
  // reset alike, gets built from it, so it has to be the origin actually
  // serving apps/dashboard.
  //
  // Kept apart from publicUrl above because in every deployment that
  // matters those are different hosts. Vercel serves the dashboard, Azure
  // serves this API.
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',

  database: {
    url: process.env.DATABASE_URL,
    // Session-mode connection, used only by the Prisma CLI (migrate, db
    // push) when DATABASE_URL points at a transaction-mode pooler. See
    // prisma.config.ts. Optional, and the running app never touches it;
    // it's listed here for the same reason `url` is.
    directUrl: process.env.DIRECT_URL,
    // pg.Pool sizing. Read straight from env in prisma.service.ts, same as
    // `url` above; that file explains why this one config key goes round
    // ConfigService. Documented here regardless, for the reason `url` is:
    // one place listing every env-driven knob.
    //
    // Worth understanding: every pod's pool is competing for the same
    // Postgres max_connections, and this is the real ceiling on horizontal
    // API scaling. N pods × this value has to stay comfortably under
    // max_connections, minus headroom for migrations and admin connections.
    // docs/production/capacity-report.md has the measured sizing.
    //
    // Once pod count pushes N × poolMax anywhere near that ceiling, the
    // recommended topology is PgBouncer in transaction mode in front of
    // Postgres. See infrastructure/k8s.
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
    poolIdleTimeoutMs: parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
    poolConnectionTimeoutMs: parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? '5000', 10),
  },

  redis: {
    url: process.env.REDIS_URL,
    // Ceiling on a single Redis command. Exists so a hung Redis, whether
    // that's a partition or a paused container, surfaces as an error the
    // callers can fail open on instead of an unbounded wait. See
    // redis.service.ts.
    commandTimeoutMs: parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS ?? '2000', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },

  // OAuth sign-in. A provider is "enabled" when its client id is set;
  // env.validation.ts has already refused a half-configured provider at
  // boot, so enabled here implies a secret exists too. Callback URLs
  // default to the dashboard's own OAuth callback route — the dashboard,
  // not this API, is what the provider redirects the browser back to
  // (mirrors how email links point at appUrl).
  oauth: {
    // How long an issued `state` value stays redeemable. One authorization
    // round-trip through the provider, so minutes, not hours.
    stateTtlSeconds: parseInt(process.env.OAUTH_STATE_TTL_SECONDS ?? '600', 10),
    github: {
      enabled: Boolean(process.env.GITHUB_CLIENT_ID),
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackUrl:
        process.env.GITHUB_CALLBACK_URL ??
        `${process.env.APP_URL ?? 'http://localhost:3000'}/api/auth/oauth/github/callback`,
    },
    google: {
      enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl:
        process.env.GOOGLE_CALLBACK_URL ??
        `${process.env.APP_URL ?? 'http://localhost:3000'}/api/auth/oauth/google/callback`,
    },
  },

  rtcToken: {
    defaultTtlSeconds: parseInt(process.env.RTC_TOKEN_DEFAULT_TTL_SECONDS ?? '600', 10),
    // Signing key for Raven's own RTC tokens (rtc-token-signer.service.ts).
    // Separate from JWT_SECRET (dashboard sessions) and CHAT_TOKEN_SECRET
    // (chat), so no one credential can mint another's. Same reasoning as
    // chat.tokenSecret below.
    //
    // It falls back to JWT_SECRET purely so local dev boots after a
    // `git pull`. Production validation rejects that.
    secret: process.env.RTC_TOKEN_SECRET ?? process.env.JWT_SECRET,
  },

  rtc: {
    // Where the client SDK connects to run a call: Raven's own signaling
    // WebSocket, handed to clients as `endpoint` in the token-mint
    // response. This is the *control* path's address. Media gets negotiated
    // over it and never flows through it (spec §6).
    //
    // Derived from the API's own public URL, so there's one address to
    // configure rather than two, exactly like chat's chatUrl(). Only
    // override it when signaling sits behind a different hostname or
    // ingress from the REST API.
    signalingUrl: process.env.RTC_SIGNALING_URL,
  },

  sfu: {
    // Shared secret the SFU fleet authenticates to the control plane with
    // when registering and heartbeating (spec §23, §26, §38).
    // Server-to-server only: never handed to a client, and never the same
    // key as any client-facing token secret.
    registrationSecret: process.env.SFU_REGISTRATION_SECRET ?? process.env.JWT_SECRET,
    // An SFU that hasn't heartbeated inside this window counts as unhealthy
    // and stops getting new room allocations. Has to comfortably exceed the
    // SFU's own heartbeat interval, or healthy nodes start flapping.
    heartbeatTimeoutSeconds: parseInt(process.env.SFU_HEARTBEAT_TIMEOUT_SECONDS ?? '30', 10),
    // Default region for room allocation when a request names none and the
    // project has no configured preference.
    defaultRegion: process.env.SFU_DEFAULT_REGION ?? 'local',
  },

  turn: {
    // Host-facing. This is what a real client gets back, not the internal
    // container address.
    host: process.env.TURN_HOST ?? 'localhost',
    port: parseInt(process.env.TURN_PORT ?? '3478', 10),
    // Only advertised as a turns: ICE server when set. Leave unset if
    // coturn has no TLS cert configured.
    tlsPort: process.env.TURN_TLS_PORT ? parseInt(process.env.TURN_TLS_PORT, 10) : undefined,
    secret: process.env.TURN_SECRET,
    // The STUN health check runs inside the api container, so it wants
    // coturn's Docker service name here, not the host-facing TURN_HOST.
    internalHost: process.env.TURN_INTERNAL_HOST ?? 'coturn',
  },

  apiKey: {
    // Pepper mixed into the secret before hashing. The per-key bcrypt salt
    // lives in the hash itself, in the DB. This pepper lives only in env
    // config, so a DB leak on its own isn't enough to brute-force key
    // secrets.
    pepper: process.env.API_KEY_HASH_SECRET,
  },

  cors: {
    // Comma-separated allowed origins, or "*" for local dev only. Don't
    // ship "*" to production.
    origin: process.env.CORS_ORIGIN ?? '*',
  },

  rateLimit: {
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10),
  },

  signaling: {
    maxParticipantsPerRoom: parseInt(process.env.SIGNALING_MAX_PARTICIPANTS_PER_ROOM ?? '50', 10),
    maxMessageBytes: parseInt(process.env.SIGNALING_MAX_MESSAGE_BYTES ?? '16384', 10),
    // Per-connection message rate limit, in-memory sliding window. No Redis
    // needed for this one.
    maxMessagesPerWindow: parseInt(process.env.SIGNALING_MAX_MESSAGES_PER_WINDOW ?? '100', 10),
    messageWindowSeconds: parseInt(process.env.SIGNALING_MESSAGE_WINDOW_SECONDS ?? '10', 10),
    // Connection attempts per client IP. This one *is* Redis-backed and
    // shares the HTTP API's limiter, because it's guarding the upgrade
    // handshake instead of throughput on a connection that's already up.
    maxConnectionsPerWindow: parseInt(process.env.SIGNALING_MAX_CONNECTIONS_PER_WINDOW ?? '20', 10),
  },

  chat: {
    // Chat tokens are signed with their own secret, never JWT_SECRET. A
    // leaked dashboard-session secret must not be able to mint a chat token,
    // and vice versa.
    //
    // Falls back to JWT_SECRET purely so local dev works out of the box
    // after a `git pull`. Production validation (env.validation.ts) rejects
    // that.
    tokenSecret: process.env.CHAT_TOKEN_SECRET ?? process.env.JWT_SECRET,
    tokenDefaultTtlSeconds: parseInt(process.env.CHAT_TOKEN_DEFAULT_TTL_SECONDS ?? '3600', 10),
    tokenMaxTtlSeconds: parseInt(process.env.CHAT_TOKEN_MAX_TTL_SECONDS ?? String(6 * 60 * 60), 10),

    // Payload ceilings (spec §38). Enforced identically on the WebSocket
    // and the HTTP path; a limit only one transport honours isn't a limit.
    maxTextLength: parseInt(process.env.CHAT_MAX_TEXT_LENGTH ?? '4000', 10),
    maxMetadataBytes: parseInt(process.env.CHAT_MAX_METADATA_BYTES ?? '4096', 10),
    maxFrameBytes: parseInt(process.env.CHAT_MAX_FRAME_BYTES ?? '65536', 10),
    maxReactionsPerMessage: parseInt(process.env.CHAT_MAX_REACTIONS_PER_MESSAGE ?? '200', 10),
    maxRoomSubscriptionsPerConnection: parseInt(process.env.CHAT_MAX_ROOM_SUBSCRIPTIONS ?? '20', 10),
    maxHistoryPageSize: parseInt(process.env.CHAT_MAX_HISTORY_PAGE_SIZE ?? '100', 10),

    // Per-user sliding budgets, Redis-backed so they hold across gateway
    // instances. Unlike the RTC signaling limiter, which is per-socket.
    sendRateLimit: parseInt(process.env.CHAT_SEND_RATE_LIMIT ?? '30', 10),
    sendRateWindowSeconds: parseInt(process.env.CHAT_SEND_RATE_WINDOW_SECONDS ?? '10', 10),
    reactionRateLimit: parseInt(process.env.CHAT_REACTION_RATE_LIMIT ?? '60', 10),
    typingRateLimit: parseInt(process.env.CHAT_TYPING_RATE_LIMIT ?? '20', 10),
    subscribeRateLimit: parseInt(process.env.CHAT_SUBSCRIBE_RATE_LIMIT ?? '60', 10),
    connectionRateLimit: parseInt(process.env.CHAT_CONNECTION_RATE_LIMIT ?? '30', 10),

    // Ephemeral-state TTLs. presenceTtl has to outlive a heartbeat cycle,
    // or a healthy connection flaps offline between pings.
    presenceTtlSeconds: parseInt(process.env.CHAT_PRESENCE_TTL_SECONDS ?? '45', 10),
    typingTtlSeconds: parseInt(process.env.CHAT_TYPING_TTL_SECONDS ?? '7', 10),

    // Default message retention, overridable per conversation. 0 means keep
    // forever. The sweeper only runs when this, or a conversation override,
    // is actually set. See docs/chat/overview.md#retention.
    retentionDays: parseInt(process.env.CHAT_RETENTION_DAYS ?? '0', 10),
    retentionSweepIntervalMs: parseInt(process.env.CHAT_RETENTION_SWEEP_INTERVAL_MS ?? String(6 * 60 * 60 * 1000), 10),
  },

  webhooks: {
    maxAttempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '6', 10),
    // Base for the exponential backoff: 10s, 20s, 40s, 80s, 160s, 320s.
    backoffBaseMs: parseInt(process.env.WEBHOOK_BACKOFF_BASE_MS ?? '10000', 10),
    timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
    // How often the delivery worker goes looking for due deliveries.
    // Nowhere near the message hot path (spec §32).
    pollIntervalMs: parseInt(process.env.WEBHOOK_POLL_INTERVAL_MS ?? '2000', 10),
    batchSize: parseInt(process.env.WEBHOOK_BATCH_SIZE ?? '20', 10),
    // An endpoint failing this many deliveries in a row gets disabled, so a
    // dead URL stops burning retry budget forever.
    disableAfterConsecutiveFailures: parseInt(process.env.WEBHOOK_DISABLE_AFTER_FAILURES ?? '50', 10),
  },

  storage: {
    // S3-compatible object storage for chat attachments: MinIO locally,
    // S3/R2/Spaces in production. Leave the bucket unset and attachments
    // are disabled, which the API says out loud, not half-working.
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    bucket: process.env.STORAGE_BUCKET,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    // MinIO wants path-style (http://host/bucket/key). Real S3 prefers
    // virtual-host style.
    forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
    uploadUrlTtlSeconds: parseInt(process.env.STORAGE_UPLOAD_URL_TTL_SECONDS ?? '900', 10),
    downloadUrlTtlSeconds: parseInt(process.env.STORAGE_DOWNLOAD_URL_TTL_SECONDS ?? '900', 10),
    maxAttachmentBytes: parseInt(process.env.STORAGE_MAX_ATTACHMENT_BYTES ?? String(25 * 1024 * 1024), 10),
  },

  email: {
    // Off by default so a fresh clone boots, registers a user and runs the
    // suite with no Resend account at all.
    //
    // Disabled does not mean "pretend it worked". email.service.ts logs the
    // message it would have sent and reports skipped, because a fake
    // success is how a broken production mailer stays invisible for a
    // week.
    enabled: (process.env.EMAIL_ENABLED ?? 'false') === 'true',

    // Server-side only, and the reason the dashboard is a BFF at all: this
    // value must never reach a browser bundle, a mobile app, or an SDK
    // package. Never logged either; email.service.ts logs metadata, never
    // config.
    apiKey: process.env.RESEND_API_KEY,

    // The sending identity. Has to be an address on a domain verified in
    // Resend (mail.ravenstack.online), not the apex the website uses. See
    // docs/email.md#domains.
    //
    // The default only ever applies while email is off: once
    // EMAIL_ENABLED=true, env.validation.ts requires this to be set
    // explicitly, because which mailbox a deployment sends as is a
    // decision, not something to inherit from a repository default.
    fromEmail: process.env.RESEND_FROM_EMAIL ?? 'hello@mail.ravenstack.online',
    fromName: process.env.RESEND_FROM_NAME ?? 'Raven',
    // Where a human reply lands. Leave it unset and replies go to
    // fromEmail, which is fine only if somebody actually reads that
    // mailbox.
    replyTo: process.env.EMAIL_REPLY_TO,
    // Printed in email footers so a stuck user has somewhere to go.
    supportEmail: process.env.EMAIL_SUPPORT_EMAIL ?? 'support@mail.ravenstack.online',
    // Linked from the welcome email. A public documentation URL, not an
    // app route, so it does not follow appUrl.
    docsUrl: process.env.DOCS_URL ?? 'https://docs.ravenstack.online',

    // Token lifetimes. Verification gets a generous day, because people
    // check their email late. A password reset doesn't, because it's a live
    // credential sitting in an inbox; the short window is the whole point.
    verificationTtlMinutes: parseInt(process.env.EMAIL_VERIFICATION_TTL_MINUTES ?? '1440', 10),
    passwordResetTtlMinutes: parseInt(process.env.PASSWORD_RESET_TTL_MINUTES ?? '60', 10),

    // Per-recipient, per-type cooldown in Redis. Stops a retry loop, or an
    // impatient user, turning one signup into fifty sends. The free tier is
    // 100/day, and one runaway caller can eat that before lunch.
    cooldownSeconds: parseInt(process.env.EMAIL_COOLDOWN_SECONDS ?? '60', 10),

    // Free-tier ceilings, enforced here rather than discovered as a 429
    // coming back from Resend. Defaults match the current free plan:
    // 100/day, 3,000/month. Raise them when the plan changes. Don't remove
    // them.
    dailyLimit: parseInt(process.env.EMAIL_DAILY_LIMIT ?? '100', 10),
    monthlyLimit: parseInt(process.env.EMAIL_MONTHLY_LIMIT ?? '3000', 10),

    // Bounded retry, and only for transient failures: 5xx, rate limit,
    // network. Permanent failures aren't retried at all. See
    // classifyResendError() in email.service.ts.
    maxAttempts: parseInt(process.env.EMAIL_MAX_ATTEMPTS ?? '3', 10),
    retryBaseMs: parseInt(process.env.EMAIL_RETRY_BASE_MS ?? '500', 10),

    // Local development only. Prints the rendered text part: including
    // the single-use verification/reset link: when email is disabled,
    // because otherwise those flows cannot be completed on a laptop (the
    // token is only ever stored as a SHA-256). Refused at boot when
    // NODE_ENV=production.
    devPreview: (process.env.EMAIL_DEV_PREVIEW ?? 'false') === 'true',
  },

  logging: {
    // A pino level name (trace/debug/info/warn/error/fatal), not a Nest
    // ConsoleLogger level. This is the one logging knob that varies by
    // deployment; the JSON shape and fields themselves are fixed in main.ts
    // under nativeLoggerOptions.
    level: process.env.LOG_LEVEL ?? 'info',
  },

  usage: {
    // How many minutes a *newly provisioned* allowance is granted. It is
    // snapshotted onto the UsageAllowance row, so lowering this later never
    // takes minutes away from a developer who already has them, and raising
    // it never retroactively grants them. See docs/usage-metering.md.
    freeTierMinutes: parseInt(process.env.USAGE_FREE_TIER_MINUTES ?? '20000', 10),

    // Whether an exhausted allowance actually refuses new RTC sessions. On
    // by default: an allowance nothing enforces is a number on a page, not
    // a limit. A self-hosted deployment running its own SFU and TURN fleet
    // has no reason to cap itself, and turns this off.
    enforceLimit: (process.env.USAGE_ENFORCE_LIMIT ?? 'true') !== 'false',

    // How often a gateway settles the sessions it is holding. Every
    // settlement is a fresh (now - startedAt) reading rather than an
    // increment, so this interval is the *maximum* usage a hard crash can
    // lose, not an error that accumulates. Matched to the signaling
    // heartbeat: the same sweep is already proving those sessions alive.
    meterIntervalMs: parseInt(process.env.USAGE_METER_INTERVAL_MS ?? '30000', 10),

    // How often the reaper looks for sessions whose gateway died without
    // closing them.
    reaperIntervalMs: parseInt(process.env.USAGE_REAPER_INTERVAL_MS ?? '60000', 10),

    // A live session not settled inside this window is treated as abandoned
    // and closed at its last confirmed-alive instant. Has to comfortably
    // exceed meterIntervalMs, or the reaper starts closing healthy sessions
    // between their own settlements.
    abandonedAfterMs: parseInt(process.env.USAGE_ABANDONED_AFTER_MS ?? '180000', 10),
  },

  observability: {
    // Retention defaults. RetentionService sweeps them on an interval
    // instead of a cron job, so we don't pull in a scheduling dependency
    // for it.
    connectionRetentionDays: parseInt(process.env.OBSERVABILITY_CONNECTION_RETENTION_DAYS ?? '30', 10),
    errorRetentionDays: parseInt(process.env.OBSERVABILITY_ERROR_RETENTION_DAYS ?? '30', 10),
    retentionSweepIntervalMs: parseInt(
      process.env.OBSERVABILITY_RETENTION_SWEEP_INTERVAL_MS ?? String(60 * 60 * 1000),
      10,
    ),
  },
});
