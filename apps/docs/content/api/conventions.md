---
title: API Conventions
description: Base path, credentials, the error envelope, request ids, idempotency, pagination, and environments.
---

Everything on the endpoint pages assumes what is on this one.

## Base path

All versioned routes live under `/v1`. There is no unversioned alias.

```
https://api.your-raven-deployment.example/v1/...
```

On a local stack the host is `http://localhost:4100` — see
[Docker Compose](/self-hosting/docker-compose).

## Authentication

Send the credential as a bearer token:

```bash
curl https://api.your-raven-deployment.example/v1/rooms \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

A project API key has the form `rvk_<env>_<publicId>.<secret>` — the
environment is part of the key, so a development key cannot reach production
data however it is asked. See [API keys](/authentication/api-keys).

## The error envelope

Every error has the same shape:

```json
{
  "code": "RAVEN_ROOM_NOT_FOUND",
  "legacyCode": "NOT_FOUND",
  "message": "Room not found",
  "requestId": "req_9f2c41ab77e0c3d5b1a4e8f2",
  "path": "/v1/rooms/room_missing"
}
```

Switch on `code`. `legacyCode` is deprecated and exists only for callers
written before the namespace did. Some errors add fields — a 429 carries
`retryAfterSeconds`. Ignore fields you do not recognise rather than treating
them as an error.

Every code is listed in [Errors](/reference/errors).

## Request ids

Every response carries `x-request-id`, and error bodies repeat it as
`requestId`. Quote it in a bug report.

Send your own to trace one call across your logs and Livqeno's:

```
x-request-id: 7c1f9e2a-your-own-correlation-id
```

An inbound value is adopted only when it is 1–64 characters of
`A-Za-z0-9_-`. Anything else is discarded and a fresh id generated — a
half-sanitised identifier in a log line is worth less than an honest new
one. Generated ids look like `req_` followed by 24 hex characters.

## Idempotency

Endpoints that mint a credential or create a message accept an
`Idempotency-Key` header. Retrying with the same key replays the original
response instead of doing the work twice.

```bash
curl -X POST .../v1/rooms/$ROOM_ID/rtc-tokens \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d '{"participantIdentity":"user-42","permissions":{"join":true,"subscribe":true}}'
```

The replay window for token minting is deliberately short — 5 minutes —
because a token can expire in as little as 30 seconds, and replaying past
that would hand back a dead credential. See [Idempotency](/backend/idempotency).

The endpoint pages mark which routes support it.

## Pagination

Chat message history uses opaque cursors, never an offset:

```
GET /v1/chat/conversations/{room}/messages?limit=50
GET /v1/chat/conversations/{room}/messages?before=<cursor>
```

Read `nextCursor` from the response and pass it back. Do not construct or
parse a cursor — an unreadable one returns `RAVEN_INVALID_CURSOR` rather
than silently resetting to the first page. See
[Message history](/chat/message-history).

## Environments

API-key routes take no `environment` parameter: the key decides. A
dashboard-session route that needs one accepts `?environment=` and defaults
to development.

See [Environments](/production/environments).

## Rate limits

A handful of routes are limited. The endpoint pages state the budget per
route; [Rate limits](/production/rate-limits) explains what the budget is
keyed on and how to read a 429.

## Next steps

- [All endpoints](/api/all-endpoints) — the full surface.
- [Authentication](/authentication) — picking the right credential.
- [Errors](/reference/errors) — the complete code list.
