---
title: Rate Limits
description: Keyed by identity when one exists, IP only when it doesn't.
---

Rate limits are a fixed-window counter, applied to the routes with real
abuse potential. **16** routes carry a budget; the window defaults to 60
seconds (`RATE_LIMIT_WINDOW_SECONDS`).

| Route | Per window |
|---|---|
| `POST /v1/auth/register` | 5 |
| `POST /v1/auth/login` | 10 |
| `POST /v1/auth/verify-email` | 10 |
| `POST /v1/auth/verify-email/resend` | 3 |
| `POST /v1/auth/password-reset` | 5 |
| `POST /v1/auth/password-reset/confirm` | 5 |
| `POST /v1/auth/oauth/{provider}/start` | 20 |
| `POST /v1/auth/oauth/{provider}/exchange` | 10 |
| `POST /v1/projects/{projectId}/api-keys` | 20 |
| `POST /v1/rooms/{roomId}/rtc-tokens` | 60 |
| `POST /v1/projects/{projectId}/rooms/{roomId}/test-token` | 30 |
| `POST /v1/live-streams` | 30 |
| `POST /v1/live-streams/{streamId}/hosts` | 60 |
| `POST /v1/live-streams/{streamId}/viewer-tokens` | 120 |
| `POST /v1/telemetry/events` | 600 |

The generated [Limits & quotas](/reference/limits) page carries this same
table straight from the decorators, so it cannot drift.

## What the budget is keyed on

The most specific identity a request actually carries, checked in this
order:

1. **The API key's own public id**, when a request is authenticated with
   one. Keyed on the key itself, not its project — two keys on one
   project don't share a budget, so a noisy or compromised key can't
   spend its sibling's headroom.
2. **The signed-in user's id**, for dashboard-session routes.
3. **Client IP**, only when neither exists — registration and login have
   no identity yet to key on.

Identity is never combined with IP once one is available. An
authenticated abuser rotating IPs is still one identity and stays capped
as one; folding IP back in would only reopen the problem identity-based
keying exists to fix — every legitimate user behind one corporate NAT
sharing a single bucket.

## Reading a 429

```json
{
  "code": "RAVEN_RATE_LIMITED",
  "message": "Too many requests — please try again later",
  "retryAfterSeconds": 42,
  "requestId": "req_9f2c41ab77e0c3d5b1a4e8f2"
}
```

`retryAfterSeconds` is read from the limiter's own remaining window —
use it rather than a fixed backoff.

## Chat and signaling have their own limiters

Chat's rate limits (send, react, type, subscribe, connect) are separate
and already keyed per-subject — a chat token always carries an identity
by the time a limited action happens, so it never had the IP-only
problem. Signaling's WebSocket-upgrade limiter is IP-only by necessity:
it guards the connection attempt itself, before any token is verified —
the same situation login and registration are in.

See [WebSocket Protocol](/chat/websocket) for the close code a
chat-side limit produces.
