---
title: Webhooks
description: HMAC-signed, retried, environment-scoped delivery — and how to verify it correctly.
---

Webhooks let your backend react to events without polling. Register a
URL from the dashboard or the API, and Livqeno POSTs each event to it.

Webhooks are project-scoped, one pipeline for every event source — see
[Event Catalogue](/reference/events) for what's available today.

## Registering an endpoint

```http
POST /v1/projects/{projectId}/webhooks
{ "url": "https://api.example.com/hooks", "environment": "PRODUCTION" }
```

Every endpoint belongs to exactly **one environment** — a staging
endpoint never receives production events, and vice versa. Getting this
scoping wrong would mean real customer data landing on whatever URL
someone pointed at their laptop while testing, so it's checked before
anything is even queued. See [Environments](/production/environments).

Subscribe to specific events, or leave the list empty for all of them.

## The payload

```json
{
  "id": "evt_GSyoZrH7qF3tZms0QsW4Gw",
  "type": "message.created",
  "projectId": "3e48ccb1-...",
  "environment": "PRODUCTION",
  "createdAt": "2026-08-18T12:00:00.000Z",
  "data": { "message": { "id": "msg_3xR…", "roomId": "conv_9WcQ…", "senderId": "alice", "text": "Hello everyone!" } }
}
```

| Header | Contains |
|---|---|
| `Raven-Signature` | `t=<unix>,v1=<hmac-sha256>` |
| `Raven-Event-Id` | The `evt_...` id — dedupe on this |
| `Raven-Event-Type` | The event type |

`message.created` includes message text — that's the point of the
event, but it means your endpoint is handling user content. Use HTTPS,
and think about what your own logs retain.

## Verifying a delivery

Do this. An unverified endpoint accepts anything anyone POSTs to it, and
yours is a public URL that can create side effects in your system.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const timestamp = Number(parts.t);

  // Reject anything older than five minutes — this is what stops a
  // captured delivery being replayed later.
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(parts.v1 ?? '', 'utf8');
  const b = Buffer.from(expected, 'utf8');

  // Length check first: timingSafeEqual throws on a mismatch, and a plain
  // === leaks the expected signature one byte at a time.
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Three things easy to get wrong:

- **Sign the raw body, not a re-serialized object.** `JSON.parse` then
  `JSON.stringify` can reorder keys and change whitespace, and the
  signature won't match — capture the raw bytes before your JSON
  middleware touches them.
- **The timestamp is inside the signed payload**, not merely alongside
  it — that's what makes the replay check meaningful; an attacker can't
  bolt a fresh timestamp onto a captured request.
- **Use a constant-time compare** — a naive `===` leaks the expected
  signature through timing to anyone willing to make enough attempts.

## Retries

Delivery is asynchronous and never blocks the path that produced the
event — a message is stored and fanned out to connected clients before
its webhook is even queued, so a slow endpoint costs your users nothing.

Any non-2xx response, a timeout, or a connection failure retries with
exponential backoff: 10s, 20s, 40s, 80s, 160s, 320s, then marked
`FAILED`. After 50 consecutive failures across all deliveries, the
endpoint is **auto-disabled** so a permanently dead URL stops burning
retry budget forever — fix it and re-enable from the dashboard, which
also clears the failure count.

## Idempotency and ordering

**Assume you will receive duplicates.** A delivery can succeed while the
response is lost, or the worker can restart mid-batch. Dedupe on
`Raven-Event-Id` — stable across every retry of the same event.

**Ordering isn't guaranteed.** Retries mean a delayed event can arrive
after a later one. Order by `createdAt` in the payload rather than
arrival, and don't build state machines that assume sequence.

## Responding

Return 2xx as fast as you can and do the real work asynchronously. The
delivery timeout is 5 seconds; anything slower is recorded as a failure
and retried, turning slow processing into duplicates.

## Security

**Signing secrets are shown once**, at creation, never returned again.
Unlike an API key secret, Livqeno does store it — signing each delivery
requires it. Rotation is delete-and-recreate.

**SSRF is partially mitigated.** Livqeno refuses obvious internal
targets: non-HTTP schemes, loopback, and private-range addresses
(outside local development); production additionally requires
`https://`. This check is hostname-level only — it doesn't resolve DNS,
so a hostname that resolves to a private IP still gets through, as does
a redirect to one. A production deployment should egress-filter the
delivery worker at the network level; this is a known limitation, stated
rather than implied.
