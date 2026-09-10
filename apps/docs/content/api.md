---
title: API Reference
description: One versioned REST API, shared by every SDK and the CLI. Base path /v1.
---

Every Livqeno SDK and the CLI call the same REST API. There is no private
surface: what an SDK does, you can do with `curl` and the same
[credential](/authentication).

The reference pages below are **generated from the API's controllers**, so
they list what the server actually serves — all 110 versioned endpoints,
with each one's credential, rate limit and validated parameters.

## Where to start

| If you want to | Read |
|---|---|
| Understand the base path, error shape and pagination | [Conventions](/api/conventions) |
| Mint a token for a call | [RTC API](/api/rtc) |
| Create conversations, post messages server-side | [Chat API](/api/chat) |
| Run a live stream | [Live Streaming API](/api/live-streams) |
| Read connection history and errors | [Observability API](/api/observability) |
| Register a webhook endpoint | [Webhooks API](/api/webhooks) |
| Manage projects, teammates and keys | [Projects API](/api/projects) |
| See everything at once | [All endpoints](/api/all-endpoints) |

## Interactive schemas

The API serves its own OpenAPI document. On a local stack:

```
http://localhost:4100/docs
```

That is the place to read full response schemas and try a request against
your own data. These pages cover request parameters, credentials and
semantics; the OpenAPI document covers response shapes.

## Which credential

Four credentials exist and none can act for another.

| Credential | Sent as | Used by |
|---|---|---|
| Project API key | `Authorization: Bearer rvk_<env>_id.secret` | Your backend |
| RTC token | Query parameter on the signaling socket | A browser or device in a call |
| Chat token | `Authorization: Bearer …`, or a query parameter on the chat socket | A browser or device in a conversation |
| Dashboard session | `Authorization: Bearer <jwt>` | The dashboard and the CLI |

Full model in [Authentication](/authentication).

## Next steps

- [Conventions](/api/conventions) — read this before the endpoint pages.
- [Errors](/reference/errors) — every code the API returns.
- [Limits & quotas](/reference/limits) — the ceilings you will meet.
