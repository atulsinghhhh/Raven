---
title: REST API
description: The full resource map — versioned, project-scoped, and shared by every SDK.
---

Every SDK and the CLI call the same versioned REST API. There's no
separate "internal" API — what your SDK does, you can do with `curl` and
your own HTTP client, using the same [tokens](/server/tokens) and the
same [error shape](/reference/errors).

Base path: `/v1`. Interactive docs (Swagger) are served at `/docs` on
your Raven deployment.

## Auth and projects

```
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/logout

POST   /v1/projects
GET    /v1/projects
GET    /v1/projects/{id}
PATCH  /v1/projects/{id}
DELETE /v1/projects/{id}
```

## Members and roles

```
GET    /v1/projects/{id}/members
POST   /v1/projects/{id}/members
PATCH  /v1/projects/{id}/members/{userId}
DELETE /v1/projects/{id}/members/{userId}
```

See [Roles & Permissions](/production/roles-and-permissions).

## API keys

```
POST   /v1/projects/{id}/api-keys
GET    /v1/projects/{id}/api-keys
DELETE /v1/projects/{id}/api-keys/{keyId}
```

## Rooms and RTC tokens

```
POST   /v1/rooms                          (API key)
GET    /v1/rooms                          (API key)
GET    /v1/rooms/{id}                     (API key)
DELETE /v1/rooms/{id}                     (API key)
GET    /v1/rooms/{id}/participants        (API key)
POST   /v1/rooms/{roomId}/rtc-tokens      (API key)

GET    /v1/projects/{id}/rooms            (dashboard session)
POST   /v1/projects/{id}/rooms            (dashboard session)
```

## Chat

```
POST   /v1/chat/tokens
POST   /v1/chat/conversations
GET    /v1/chat/conversations
GET    /v1/chat/conversations/{room}
PATCH  /v1/chat/conversations/{room}
POST   /v1/chat/conversations/{room}/members
GET    /v1/chat/conversations/{room}/members
DELETE /v1/chat/conversations/{room}/members/{userId}

GET    /v1/chat/conversations/{room}/messages
POST   /v1/chat/conversations/{room}/messages
GET    /v1/chat/messages/{messageId}
GET    /v1/chat/messages/{messageId}/thread
PATCH  /v1/chat/messages/{messageId}
DELETE /v1/chat/messages/{messageId}
POST   /v1/chat/messages/{messageId}/reactions
DELETE /v1/chat/messages/{messageId}/reactions/{emoji}
POST   /v1/chat/messages/{messageId}/read

GET    /v1/chat/conversations/{room}/read-state
GET    /v1/chat/conversations/{room}/read-receipts
GET    /v1/chat/conversations/{room}/presence
GET    /v1/chat/conversations/{room}/typing

POST   /v1/chat/conversations/{room}/attachments
POST   /v1/chat/attachments/{attachmentId}/complete
GET    /v1/chat/attachments/{attachmentId}/download-url
```

Dashboard-facing chat inspection (never message content):

```
GET    /v1/projects/{id}/chat/overview
GET    /v1/projects/{id}/chat/conversations
GET    /v1/projects/{id}/chat/connections
GET    /v1/projects/{id}/chat/conversations/{conversationId}/presence
```

## Webhooks

```
POST   /v1/projects/{id}/webhooks
GET    /v1/projects/{id}/webhooks
GET    /v1/projects/{id}/webhooks/{webhookId}/deliveries
PATCH  /v1/projects/{id}/webhooks/{webhookId}
DELETE /v1/projects/{id}/webhooks/{webhookId}
```

## Observability

```
GET    /v1/projects/{id}/connections
GET    /v1/projects/{id}/connections/{connectionId}
GET    /v1/projects/{id}/errors
GET    /v1/projects/{id}/errors/{errorId}
GET    /v1/projects/{id}/metrics
GET    /v1/projects/{id}/diagnostics

POST   /v1/telemetry/events        (RTC token — SDK-internal, see below)
```

## Audit log

```
GET    /v1/projects/{id}/audit-logs
```

Read-only — see [Audit Logs](/production/audit-logs). No endpoint can
update or delete an entry.

## Authentication per route group

| Group | Credential |
|---|---|
| `/v1/auth/*`, `/v1/projects/*` (management), members, audit log | Dashboard session (JWT) |
| `/v1/rooms/*`, `/v1/rooms/*/rtc-tokens`, `/v1/chat/*` (as a server) | Project API key |
| `/v1/chat/*` (as a client) | Chat token |
| `/v1/telemetry/events` | The RTC token the client already holds |

Dashboard-facing project sub-resources (`/v1/projects/{id}/rooms`,
`/v1/projects/{id}/chat/*`, `/v1/projects/{id}/connections`, etc.) all
take a dashboard session and are gated by
[project roles](/production/roles-and-permissions) — a viewer can read
them, most cannot write.

## Pagination, filtering, environments

- Chat message history uses opaque cursors (`before`/`after`) — never
  `offset`. See [Messages & Threads](/chat/messages#history).
- API-key-authenticated routes never take an `environment` parameter —
  the key itself decides. Dashboard-session routes that need one accept
  `?environment=` and default to development. See
  [Environments](/production/environments).
