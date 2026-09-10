---
title: Environment variables
description: Every variable any Livqeno component reads, grouped by what it configures. Generated from source.
---

Livqeno's components read **117** environment variables between them —
**97** by the control plane, **16** by the SFU,
**6** by the dashboard. `.env.example` documents
**105**, which leaves **22** read but
undocumented there; those are marked below.

This page is generated from the source, so it is the complete set.

## Start here

Four of these will be wrong on a first deployment more often than the
other eighty-eight:

| Variable | Why it matters |
|---|---|
| `API_PUBLIC_URL` | Becomes `telemetryUrl` in every mint response, and the base the signaling URL is derived from. If it is the container-internal address, clients cannot reach it. |
| `RTC_SIGNALING_URL` | Overrides the derived signaling address. Set it when signaling sits behind a different hostname or ingress. |
| `CORS_ORIGIN` | The chat WebSocket rejects a mismatched `Origin` with close code `4403`. Never `*` in production. |
| `TURN_HOST` | Host-facing, not the Docker service name. A container address here means no client can reach the relay. |

## Secrets that must be set explicitly

`RTC_TOKEN_SECRET` and `CHAT_TOKEN_SECRET` fall back to `JWT_SECRET` so a
fresh clone boots. Production validation refuses that fallback at start-up:
one credential must not be able to mint another's. Generate each
independently:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # RTC_TOKEN_SECRET
openssl rand -hex 32   # CHAT_TOKEN_SECRET
openssl rand -hex 32   # API_KEY_HASH_SECRET
openssl rand -hex 32   # SFU_REGISTRATION_SECRET
openssl rand -hex 32   # TURN_SECRET
```

{/* generated:endpoints — do not edit by hand */}

## All variables

### Core

| Variable | Notes |
|---|---|
| `API_PORT` |   |
| `API_PUBLIC_URL` | **not in `.env.example`** |
| `APP_URL` |   |
| `CORS_ORIGIN` |   |
| `DOCS_URL` | **not in `.env.example`** |
| `LOG_LEVEL` |   |
| `NODE_ENV` | **not in `.env.example`** |

### Database

| Variable | Notes |
|---|---|
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` |   |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` |   |
| `DATABASE_POOL_MAX` |   |
| `DATABASE_URL` |   |
| `DIRECT_URL` |   |

### Redis

| Variable | Notes |
|---|---|
| `REDIS_COMMAND_TIMEOUT_MS` |   |
| `REDIS_PASSWORD` | in `.env.example`, but no Livqeno component reads it |
| `REDIS_PORT` | in `.env.example`, but no Livqeno component reads it |
| `REDIS_URL` |   |

### Secrets & tokens

| Variable | Notes |
|---|---|
| `API_KEY_HASH_SECRET` |   |
| `CHAT_TOKEN_SECRET` |   |
| `JWT_EXPIRES_IN` |   |
| `JWT_SECRET` |   |
| `RTC_TOKEN_DEFAULT_TTL_SECONDS` |   |
| `RTC_TOKEN_SECRET` |   |
| `SFU_REGISTRATION_SECRET` |   |

### OAuth sign-in

| Variable | Notes |
|---|---|
| `GITHUB_CALLBACK_URL` | **not in `.env.example`** |
| `GITHUB_CLIENT_ID` |   |
| `GITHUB_CLIENT_SECRET` |   |
| `GOOGLE_CALLBACK_URL` | **not in `.env.example`** |
| `GOOGLE_CLIENT_ID` |   |
| `GOOGLE_CLIENT_SECRET` |   |
| `OAUTH_STATE_TTL_SECONDS` |   |

### RTC & signaling

| Variable | Notes |
|---|---|
| `RTC_SIGNALING_URL` | **not in `.env.example`** |
| `SFU_CONTROL_PLANE_URL` | read by the SFU; **not in `.env.example`** |
| `SFU_DEFAULT_REGION` |   |
| `SFU_HEARTBEAT_INTERVAL_SECONDS` | read by the SFU; **not in `.env.example`** |
| `SFU_HEARTBEAT_TIMEOUT_SECONDS` |   |
| `SFU_HTTP_ADDR` | read by the SFU; **not in `.env.example`** |
| `SFU_HTTP_PORT` | in `.env.example`, but no Livqeno component reads it |
| `SFU_INTERNAL_URL` | read by the SFU; **not in `.env.example`** |
| `SFU_LOG_LEVEL` | read by the SFU |
| `SFU_NODE_ID` | read by the SFU |
| `SFU_PUBLIC_HOST` | read by the SFU |
| `SFU_PUBLIC_IP` | read by the SFU |
| `SFU_REGION` | read by the SFU |
| `SFU_ROOM_CAPACITY` | read by the SFU |
| `SFU_STUN_SERVERS` | read by the SFU; **not in `.env.example`** |
| `SFU_UDP_PORT_MAX` | read by the SFU |
| `SFU_UDP_PORT_MIN` | read by the SFU |
| `SFU_VERSION` | read by the SFU; **not in `.env.example`** |
| `SIGNALING_MAX_CONNECTIONS_PER_WINDOW` |   |
| `SIGNALING_MAX_MESSAGES_PER_WINDOW` |   |
| `SIGNALING_MAX_MESSAGE_BYTES` |   |
| `SIGNALING_MAX_PARTICIPANTS_PER_ROOM` |   |
| `SIGNALING_MESSAGE_WINDOW_SECONDS` |   |

### TURN

| Variable | Notes |
|---|---|
| `TURN_HOST` |   |
| `TURN_INTERNAL_HOST` |   |
| `TURN_MAX_BPS` | in `.env.example`, but no Livqeno component reads it |
| `TURN_MAX_PORT` | in `.env.example`, but no Livqeno component reads it |
| `TURN_MIN_PORT` | in `.env.example`, but no Livqeno component reads it |
| `TURN_PORT` |   |
| `TURN_PROMETHEUS_PORT` | in `.env.example`, but no Livqeno component reads it |
| `TURN_REALM` | in `.env.example`, but no Livqeno component reads it |
| `TURN_SECRET` |   |
| `TURN_TLS_PORT` |   |
| `TURN_TOTAL_QUOTA` | in `.env.example`, but no Livqeno component reads it |
| `TURN_USER_QUOTA` | in `.env.example`, but no Livqeno component reads it |

### Chat

| Variable | Notes |
|---|---|
| `CHAT_CONNECTION_RATE_LIMIT` |   |
| `CHAT_MAX_FRAME_BYTES` |   |
| `CHAT_MAX_HISTORY_PAGE_SIZE` |   |
| `CHAT_MAX_METADATA_BYTES` |   |
| `CHAT_MAX_REACTIONS_PER_MESSAGE` |   |
| `CHAT_MAX_ROOM_SUBSCRIPTIONS` |   |
| `CHAT_MAX_TEXT_LENGTH` |   |
| `CHAT_PRESENCE_TTL_SECONDS` |   |
| `CHAT_REACTION_RATE_LIMIT` |   |
| `CHAT_RETENTION_DAYS` |   |
| `CHAT_RETENTION_SWEEP_INTERVAL_MS` |   |
| `CHAT_SEND_RATE_LIMIT` |   |
| `CHAT_SEND_RATE_WINDOW_SECONDS` |   |
| `CHAT_SUBSCRIBE_RATE_LIMIT` |   |
| `CHAT_TOKEN_DEFAULT_TTL_SECONDS` |   |
| `CHAT_TOKEN_MAX_TTL_SECONDS` |   |
| `CHAT_TYPING_RATE_LIMIT` |   |
| `CHAT_TYPING_TTL_SECONDS` |   |

### Attachments (object storage)

| Variable | Notes |
|---|---|
| `STORAGE_ACCESS_KEY_ID` |   |
| `STORAGE_BUCKET` |   |
| `STORAGE_DOWNLOAD_URL_TTL_SECONDS` |   |
| `STORAGE_ENDPOINT` |   |
| `STORAGE_FORCE_PATH_STYLE` |   |
| `STORAGE_MAX_ATTACHMENT_BYTES` |   |
| `STORAGE_REGION` |   |
| `STORAGE_SECRET_ACCESS_KEY` |   |
| `STORAGE_UPLOAD_URL_TTL_SECONDS` |   |

### Webhooks

| Variable | Notes |
|---|---|
| `WEBHOOK_BACKOFF_BASE_MS` |   |
| `WEBHOOK_BATCH_SIZE` |   |
| `WEBHOOK_DISABLE_AFTER_FAILURES` |   |
| `WEBHOOK_MAX_ATTEMPTS` |   |
| `WEBHOOK_POLL_INTERVAL_MS` |   |
| `WEBHOOK_TIMEOUT_MS` |   |

### Transactional email

| Variable | Notes |
|---|---|
| `EMAIL_COOLDOWN_SECONDS` |   |
| `EMAIL_DAILY_LIMIT` |   |
| `EMAIL_DEV_PREVIEW` | **not in `.env.example`** |
| `EMAIL_ENABLED` |   |
| `EMAIL_MAX_ATTEMPTS` |   |
| `EMAIL_MONTHLY_LIMIT` |   |
| `EMAIL_REPLY_TO` |   |
| `EMAIL_RETRY_BASE_MS` |   |
| `EMAIL_SUPPORT_EMAIL` |   |
| `EMAIL_VERIFICATION_TTL_MINUTES` |   |
| `PASSWORD_RESET_TTL_MINUTES` |   |
| `RESEND_API_KEY` |   |
| `RESEND_FROM_EMAIL` |   |
| `RESEND_FROM_NAME` |   |

### Observability

| Variable | Notes |
|---|---|
| `OBSERVABILITY_CONNECTION_RETENTION_DAYS` | **not in `.env.example`** |
| `OBSERVABILITY_ERROR_RETENTION_DAYS` | **not in `.env.example`** |
| `OBSERVABILITY_RETENTION_SWEEP_INTERVAL_MS` | **not in `.env.example`** |

### Rate limiting

| Variable | Notes |
|---|---|
| `RATE_LIMIT_WINDOW_SECONDS` |   |

### Other

| Variable | Notes |
|---|---|
| `HOSTNAME` | not in `.env.example` |
| `NEXT_PUBLIC_DOCS_URL` | not in `.env.example` |
| `NEXT_PUBLIC_GITHUB_URL` | not in `.env.example` |
| `NEXT_PUBLIC_SUPPORT_URL` | not in `.env.example` |
| `RAVEN_API_KEY` | not in `.env.example` |
| `RAVEN_API_URL` | not in `.env.example` |
| `USAGE_ABANDONED_AFTER_MS` |   |
| `USAGE_ENFORCE_LIMIT` |   |
| `USAGE_FREE_TIER_MINUTES` |   |
| `USAGE_METER_INTERVAL_MS` |   |
| `USAGE_REAPER_INTERVAL_MS` |   |

{/* /generated:endpoints */}

## Next steps

- [Docker Compose](/self-hosting/docker-compose) — the stack these configure.
- [Limits & quotas](/reference/limits) — the ceilings several of these set.
