---
title: Limits & quotas
description: Every ceiling and TTL a developer meets, with the variable that sets it. Generated from the API configuration.
---

Every value below is a **default**, read out of the API's configuration. A
self-hosted deployment can change any of them; a hosted one has whatever
its operator set.

Nothing here is a billing quota. The one quota Raven does enforce is the
20,000 free RTC minutes every account is granted — see
[Usage](/concepts/usage). Everything below is a technical ceiling, and none
of it is affected by how many minutes you have left.

{/* generated:endpoints — do not edit by hand */}

## Ceilings and TTLs

### RTC

| Limit | Default | Configured by |
|---|---|---|
| Participants per room | `50` | `SIGNALING_MAX_PARTICIPANTS_PER_ROOM` |
| Signaling frame size | `16384` | `SIGNALING_MAX_MESSAGE_BYTES` |
| Signaling messages per connection, per window | `100` | `SIGNALING_MAX_MESSAGES_PER_WINDOW` |
| Signaling connection attempts per IP, per window | `20` | `SIGNALING_MAX_CONNECTIONS_PER_WINDOW` |
| RTC token lifetime (default; 30–21600 allowed) | `600` | `RTC_TOKEN_DEFAULT_TTL_SECONDS` |
| Media-server heartbeat timeout | `30` | `SFU_HEARTBEAT_TIMEOUT_SECONDS` |

### Chat

| Limit | Default | Configured by |
|---|---|---|
| Message text characters | `4000` | `CHAT_MAX_TEXT_LENGTH` |
| Message metadata bytes | `4096` | `CHAT_MAX_METADATA_BYTES` |
| Chat WebSocket frame bytes | `65536` | `CHAT_MAX_FRAME_BYTES` |
| Reactions per message | `200` | `CHAT_MAX_REACTIONS_PER_MESSAGE` |
| Conversations per chat connection | `20` | `CHAT_MAX_ROOM_SUBSCRIPTIONS` |
| Message history page size | `100` | `CHAT_MAX_HISTORY_PAGE_SIZE` |
| Chat sends per user, per window | `30` | `CHAT_SEND_RATE_LIMIT` |
| Chat token lifetime (default) | `3600` | `CHAT_TOKEN_DEFAULT_TTL_SECONDS` |
| Chat token lifetime (maximum) | `21600` (6 * 60 * 60) | `CHAT_TOKEN_MAX_TTL_SECONDS` |
| Presence key TTL — expiry is the offline transition | `45` | `CHAT_PRESENCE_TTL_SECONDS` |
| Typing indicator TTL | `7` | `CHAT_TYPING_TTL_SECONDS` |

### Attachments

| Limit | Default | Configured by |
|---|---|---|
| Attachment size | `26214400` (25 * 1024 * 1024) | `STORAGE_MAX_ATTACHMENT_BYTES` |
| Signed upload URL lifetime | `900` | `STORAGE_UPLOAD_URL_TTL_SECONDS` |
| Signed download URL lifetime | `900` | `STORAGE_DOWNLOAD_URL_TTL_SECONDS` |

### Webhooks

| Limit | Default | Configured by |
|---|---|---|
| Webhook delivery attempts | `6` | `WEBHOOK_MAX_ATTEMPTS` |
| Webhook retry backoff base | `10000` | `WEBHOOK_BACKOFF_BASE_MS` |
| Webhook delivery timeout | `5000` | `WEBHOOK_TIMEOUT_MS` |
| Consecutive failures before an endpoint is disabled | `50` | `WEBHOOK_DISABLE_AFTER_FAILURES` |

### Rate limiting

| Limit | Default | Configured by |
|---|---|---|
| Rate-limit window | `60` | `RATE_LIMIT_WINDOW_SECONDS` |

## Rate-limited endpoints

**16** routes carry a per-window budget. The window itself is
`60` seconds.

| Endpoint | Per window |
|---|---|
| POST `/v1/auth/login` | 10 |
| POST `/v1/auth/oauth/{provider}/exchange` | 10 |
| POST `/v1/auth/oauth/{provider}/start` | 20 |
| POST `/v1/auth/password-reset` | 5 |
| POST `/v1/auth/password-reset/confirm` | 5 |
| POST `/v1/auth/register` | 5 |
| POST `/v1/auth/verify-email` | 10 |
| POST `/v1/auth/verify-email/resend` | 3 |
| POST `/v1/live-streams` | 30 |
| POST `/v1/live-streams/{streamId}/hosts` | 60 |
| POST `/v1/live-streams/{streamId}/viewer-tokens` | 120 |
| POST `/v1/projects/{projectId}/api-keys` | 20 |
| POST `/v1/projects/{projectId}/rooms/{roomId}/test-token` | 30 |
| POST `/v1/rooms/{roomId}/rtc-tokens` | 60 |
| DELETE `/v1/rooms/{roomId}/rtc-tokens/{tokenId}` | 60 |
| POST `/v1/telemetry/events` | 600 |

{/* /generated:endpoints */}

## What a limit looks like when you hit it

A REST limit returns `429` with `RAVEN_RATE_LIMITED` and a
`retryAfterSeconds` field — use it rather than a fixed backoff. A chat
limit arrives as a `RATE_LIMITED` error frame carrying the same field. A
signaling connection limit closes the socket with code `4429`.

## Next steps

- [Rate limits](/production/rate-limits) — what the budget is keyed on.
- [Errors](/reference/errors) · [Environment variables](/self-hosting/environment-variables)
