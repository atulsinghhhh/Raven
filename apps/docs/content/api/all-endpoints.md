---
title: All endpoints
description: Every route the Livqeno API serves, generated from the controllers.
---

Livqeno serves **116** versioned endpoints under `/v1`, plus
**4** unversioned infrastructure routes. This page is generated
from `apps/api`, so it is the whole surface — not a curated subset.

Interactive request/response schemas are served by the API itself at `/docs`.

{/* generated:endpoints — do not edit by hand */}

## Versioned API

| Method | Path | Credential | Reference |
|---|---|---|---|
| POST | `/v1/auth/login` | None | [Auth & Account](/api/auth) |
| POST | `/v1/auth/logout` | Dashboard session (JWT) | [Auth & Account](/api/auth) |
| POST | `/v1/auth/oauth/{provider}/exchange` | None | [Auth & Account](/api/auth) |
| POST | `/v1/auth/oauth/{provider}/start` | None | [Auth & Account](/api/auth) |
| GET | `/v1/auth/oauth/providers` | None | [Auth & Account](/api/auth) |
| POST | `/v1/auth/password-reset` | None | [Auth & Account](/api/auth) |
| POST | `/v1/auth/password-reset/confirm` | None | [Auth & Account](/api/auth) |
| POST | `/v1/auth/register` | None | [Auth & Account](/api/auth) |
| POST | `/v1/auth/verify-email` | None | [Auth & Account](/api/auth) |
| POST | `/v1/auth/verify-email/resend` | Dashboard session (JWT) | [Auth & Account](/api/auth) |
| POST | `/v1/chat/attachments/{attachmentId}/complete` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/attachments/{attachmentId}/download-url` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations` | Project API key **or** chat token | [Chat](/api/chat) |
| POST | `/v1/chat/conversations` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations/{room}` | Project API key **or** chat token | [Chat](/api/chat) |
| PATCH | `/v1/chat/conversations/{room}` | Project API key **or** chat token | [Chat](/api/chat) |
| POST | `/v1/chat/conversations/{room}/attachments` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations/{room}/members` | Project API key **or** chat token | [Chat](/api/chat) |
| POST | `/v1/chat/conversations/{room}/members` | Project API key **or** chat token | [Chat](/api/chat) |
| DELETE | `/v1/chat/conversations/{room}/members/{userId}` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations/{room}/messages` | Project API key **or** chat token | [Chat](/api/chat) |
| POST | `/v1/chat/conversations/{room}/messages` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations/{room}/presence` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations/{room}/read-receipts` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations/{room}/read-state` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/conversations/{room}/typing` | Project API key **or** chat token | [Chat](/api/chat) |
| DELETE | `/v1/chat/messages/{messageId}` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/messages/{messageId}` | Project API key **or** chat token | [Chat](/api/chat) |
| PATCH | `/v1/chat/messages/{messageId}` | Project API key **or** chat token | [Chat](/api/chat) |
| POST | `/v1/chat/messages/{messageId}/reactions` | Project API key **or** chat token | [Chat](/api/chat) |
| DELETE | `/v1/chat/messages/{messageId}/reactions/{emoji}` | Project API key **or** chat token | [Chat](/api/chat) |
| POST | `/v1/chat/messages/{messageId}/read` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/chat/messages/{messageId}/thread` | Project API key **or** chat token | [Chat](/api/chat) |
| POST | `/v1/chat/tokens` | Project API key **or** chat token | [Chat](/api/chat) |
| DELETE | `/v1/chat/tokens/{tokenId}` | Project API key **or** chat token | [Chat](/api/chat) |
| GET | `/v1/connections` | Project API key | [Observability](/api/observability) |
| GET | `/v1/connections/{connectionId}` | Project API key | [Observability](/api/observability) |
| GET | `/v1/diagnostics` | Project API key | [Observability](/api/observability) |
| GET | `/v1/errors` | Project API key | [Observability](/api/observability) |
| GET | `/v1/errors/{errorId}` | Project API key | [Observability](/api/observability) |
| GET | `/v1/live-streams` | Project API key | [Live Streaming](/api/live-streams) |
| POST | `/v1/live-streams` | Project API key | [Live Streaming](/api/live-streams) |
| GET | `/v1/live-streams/{streamId}` | Project API key | [Live Streaming](/api/live-streams) |
| PATCH | `/v1/live-streams/{streamId}` | Project API key | [Live Streaming](/api/live-streams) |
| POST | `/v1/live-streams/{streamId}/end` | Project API key | [Live Streaming](/api/live-streams) |
| POST | `/v1/live-streams/{streamId}/hosts` | Project API key | [Live Streaming](/api/live-streams) |
| DELETE | `/v1/live-streams/{streamId}/hosts/{identity}` | Project API key | [Live Streaming](/api/live-streams) |
| POST | `/v1/live-streams/{streamId}/leave` | Project API key | [Live Streaming](/api/live-streams) |
| POST | `/v1/live-streams/{streamId}/start` | Project API key | [Live Streaming](/api/live-streams) |
| POST | `/v1/live-streams/{streamId}/viewer-tokens` | Project API key | [Live Streaming](/api/live-streams) |
| GET | `/v1/metrics` | Project API key | [Observability](/api/observability) |
| GET | `/v1/onboarding` | None | [Auth & Account](/api/auth) |
| PATCH | `/v1/onboarding` | None | [Auth & Account](/api/auth) |
| POST | `/v1/onboarding/complete` | None | [Auth & Account](/api/auth) |
| GET | `/v1/project` | Project API key | [Observability](/api/observability) |
| GET | `/v1/projects` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| POST | `/v1/projects` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| DELETE | `/v1/projects/{id}` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| GET | `/v1/projects/{id}` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| PATCH | `/v1/projects/{id}` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| PATCH | `/v1/projects/{id}/allowed-origins` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/api-keys` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| POST | `/v1/projects/{projectId}/api-keys` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| DELETE | `/v1/projects/{projectId}/api-keys/{keyId}` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| GET | `/v1/projects/{projectId}/audit-logs` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| GET | `/v1/projects/{projectId}/chat/connections` | Dashboard session (JWT) | [Chat](/api/chat) |
| GET | `/v1/projects/{projectId}/chat/conversations` | Dashboard session (JWT) | [Chat](/api/chat) |
| GET | `/v1/projects/{projectId}/chat/conversations/{conversationId}` | Dashboard session (JWT) | [Chat](/api/chat) |
| GET | `/v1/projects/{projectId}/chat/conversations/{conversationId}/members` | Dashboard session (JWT) | [Chat](/api/chat) |
| GET | `/v1/projects/{projectId}/chat/conversations/{conversationId}/messages` | Dashboard session (JWT) | [Chat](/api/chat) |
| GET | `/v1/projects/{projectId}/chat/conversations/{conversationId}/presence` | Dashboard session (JWT) | [Chat](/api/chat) |
| GET | `/v1/projects/{projectId}/chat/overview` | Dashboard session (JWT) | [Chat](/api/chat) |
| GET | `/v1/projects/{projectId}/connections` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/connections/{connectionId}` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/diagnostics` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/errors` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/errors/{errorId}` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/live-streams` | Dashboard session (JWT) | [Live Streaming](/api/live-streams) |
| POST | `/v1/projects/{projectId}/live-streams` | Dashboard session (JWT) | [Live Streaming](/api/live-streams) |
| GET | `/v1/projects/{projectId}/live-streams/{streamId}` | Dashboard session (JWT) | [Live Streaming](/api/live-streams) |
| PATCH | `/v1/projects/{projectId}/live-streams/{streamId}` | Dashboard session (JWT) | [Live Streaming](/api/live-streams) |
| POST | `/v1/projects/{projectId}/live-streams/{streamId}/end` | Dashboard session (JWT) | [Live Streaming](/api/live-streams) |
| GET | `/v1/projects/{projectId}/members` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| POST | `/v1/projects/{projectId}/members` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| DELETE | `/v1/projects/{projectId}/members/{userId}` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| PATCH | `/v1/projects/{projectId}/members/{userId}` | Dashboard session (JWT) | [Projects, Members & Keys](/api/projects) |
| GET | `/v1/projects/{projectId}/metrics` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/rooms` | Dashboard session (JWT) | [RTC](/api/rtc) |
| POST | `/v1/projects/{projectId}/rooms` | Dashboard session (JWT) | [RTC](/api/rtc) |
| GET | `/v1/projects/{projectId}/rooms/{roomId}` | Dashboard session (JWT) | [RTC](/api/rtc) |
| POST | `/v1/projects/{projectId}/rooms/{roomId}/test-token` | Dashboard session (JWT) | [RTC](/api/rtc) |
| GET | `/v1/projects/{projectId}/usage` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/projects/{projectId}/webhooks` | Dashboard session (JWT) | [Webhooks](/api/webhooks) |
| POST | `/v1/projects/{projectId}/webhooks` | Dashboard session (JWT) | [Webhooks](/api/webhooks) |
| DELETE | `/v1/projects/{projectId}/webhooks/{webhookId}` | Dashboard session (JWT) | [Webhooks](/api/webhooks) |
| PATCH | `/v1/projects/{projectId}/webhooks/{webhookId}` | Dashboard session (JWT) | [Webhooks](/api/webhooks) |
| GET | `/v1/projects/{projectId}/webhooks/{webhookId}/deliveries` | Dashboard session (JWT) | [Webhooks](/api/webhooks) |
| GET | `/v1/rooms` | Project API key | [RTC](/api/rtc) |
| POST | `/v1/rooms` | Project API key | [RTC](/api/rtc) |
| DELETE | `/v1/rooms/{id}` | Project API key | [RTC](/api/rtc) |
| GET | `/v1/rooms/{id}` | Project API key | [RTC](/api/rtc) |
| GET | `/v1/rooms/{id}/participants` | Project API key | [RTC](/api/rtc) |
| POST | `/v1/rooms/{roomId}/rtc-tokens` | Project API key | [RTC](/api/rtc) |
| DELETE | `/v1/rooms/{roomId}/rtc-tokens/{tokenId}` | Project API key | [RTC](/api/rtc) |
| GET | `/v1/rtc/servers` | Dashboard session (JWT) | [RTC](/api/rtc) |
| GET | `/v1/rtc/servers/{name}` | Dashboard session (JWT) | [RTC](/api/rtc) |
| POST | `/v1/rtc/servers/{name}/drain` | Dashboard session (JWT) | [RTC](/api/rtc) |
| PUT | `/v1/rtc/servers/{name}/heartbeat` | SFU registration secret | [RTC](/api/rtc) |
| POST | `/v1/rtc/servers/{name}/undrain` | Dashboard session (JWT) | [RTC](/api/rtc) |
| GET | `/v1/rtc/servers/metrics` | Dashboard session (JWT) | [RTC](/api/rtc) |
| POST | `/v1/rtc/servers/register` | SFU registration secret | [RTC](/api/rtc) |
| POST | `/v1/telemetry/events` | RTC token | [Observability](/api/observability) |
| GET | `/v1/usage` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/usage/detail` | Dashboard session (JWT) | [Observability](/api/observability) |
| GET | `/v1/users/me` | None | [Auth & Account](/api/auth) |
| PATCH | `/v1/users/me` | None | [Auth & Account](/api/auth) |

## Infrastructure

Not part of the versioned API and not covered by its compatibility promise.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Alias of /health/ready, kept for backward compatibility — unauthenticated |
| GET | `/health/live` | Liveness probe — no dependency calls, unauthenticated |
| GET | `/health/ready` | Readiness probe — checks dependencies, unauthenticated |
| GET | `/metrics` | — |

{/* /generated:endpoints */}

## Next steps

- [Conventions](/api/conventions) — how to read every route above.
- [Authentication](/authentication) — which credential to send.
