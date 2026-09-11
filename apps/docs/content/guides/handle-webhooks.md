---
title: Handle webhooks
description: A receiver that verifies the signature, acknowledges fast, and cannot be fooled by a replay.
---

## What we're building

An HTTP endpoint that accepts Livqeno's webhook deliveries, proves each one
came from Livqeno, and processes it exactly once even though delivery is
at-least-once.

## Prerequisites

- A project and a dashboard session (webhook endpoints are registered with a
  session, not an API key).
- A publicly reachable URL. For local development, a tunnel — see below.

## Implementation

### 1. Register an endpoint

```bash
curl -X POST "$RAVEN_API_URL/v1/projects/$PROJECT_ID/webhooks" \
  -H "Authorization: Bearer $RAVEN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "url": "https://api.example.com/hooks/raven",
        "environment": "PRODUCTION",
        "events": ["message.created", "live_stream.ended"]
      }'
```

The signing secret is returned **once**, at creation. Store it as
`RAVEN_WEBHOOK_SECRET`. Omit `events` to receive everything, including event
types added later.

The API rejects unknown body fields outright rather than ignoring them, so a
misspelled key is a 400 rather than a subscription that silently receives
nothing.

### 2. Capture the raw body

This is the step that breaks most receivers. You must sign the **exact
bytes** Livqeno sent — `JSON.parse` then `JSON.stringify` can reorder keys and
change whitespace, and the signature will not match:

```ts
import express from 'express';

const app = express();

// Raw body for this route only; JSON parsing everywhere else.
app.post('/hooks/raven', express.raw({ type: 'application/json' }), handler);
app.use(express.json());
```

### 3. Verify

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const timestamp = Number(parts.t);

  // Reject anything older than five minutes. This is what stops a captured
  // delivery being replayed later.
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

Three things to get right, and each has a real failure mode:

1. **Sign the raw body**, not a re-serialised object.
2. **The timestamp is inside the signed payload** — that is what makes the
   replay window meaningful.
3. **Constant-time compare.** `===` leaks the expected signature through
   timing to anyone willing to make enough attempts.

### 4. Acknowledge, then work

```ts
async function handler(req: express.Request, res: express.Response) {
  const raw = req.body.toString('utf8');

  if (!verify(raw, req.header('raven-signature') ?? '', process.env.RAVEN_WEBHOOK_SECRET!)) {
    return res.sendStatus(400);
  }

  const eventId = req.header('raven-event-id')!;
  const event = JSON.parse(raw);

  res.sendStatus(200);                    // ack inside the 5s timeout
  void process(eventId, event);           // then do the real work
}
```

The delivery timeout is 5 seconds. Anything slower is recorded as a failure
and retried — which turns slow processing into duplicates.

### 5. Deduplicate

```ts
async function process(eventId: string, event: RavenEvent) {
  // Unique index on event_id. A second delivery of the same event is a no-op.
  const inserted = await db.webhookEvents.insertIfAbsent({ eventId, type: event.type });
  if (!inserted) return;

  switch (event.type) {
    case 'message.created':
      await indexMessage(event.data.message);
      break;
    case 'live_stream.ended':
      await finaliseStream(event.data);
      break;
  }
}
```

`Raven-Event-Id` is stable across every retry of the same event. A unique
index on it is the whole deduplication strategy.

### 6. Local development

Livqeno refuses obvious internal targets, and in production requires
`https://`. Loopback URLs *are* accepted outside production, so a tunnel is
the straightforward route:

```bash
# Any tunnel that gives you a public https URL works.
raven projects use my-app
# then register the tunnel URL with environment: "DEVELOPMENT"
```

Register the tunnel against the **development** environment so no
production traffic can reach your laptop.

## How it works

**The message path never waits on you.** A message is stored and fanned out
to connected clients before its webhook is even queued. A dead endpoint
cannot slow down or fail a chat message.

**Retries are exponential**: 10s, 20s, 40s, 80s, 160s, 320s, then the
delivery is marked `FAILED`. Any non-2xx, a timeout, or a connection error
retries.

**A permanently dead URL gets disabled.** After 50 consecutive failures the
endpoint is auto-disabled so it stops burning retry budget. Re-enabling
from the dashboard clears the failure count.

**Ordering is not guaranteed.** A retried event can arrive after a later
one. Order by `createdAt` in the payload, and do not build a state machine
that assumes sequence.

## Production considerations

- **Egress-filter the delivery worker.** Livqeno's SSRF check is
  hostname-level: it refuses loopback and private-range *literals* but does
  not resolve DNS, so a hostname pointing at a private address still passes.
  This is a stated limitation, not an oversight.
- **Rotation is delete-and-recreate.** There is no secret-rotation endpoint.
- **Monitor deliveries.** `GET /v1/projects/{projectId}/webhooks/{webhookId}/deliveries`
  shows attempts and last error. An endpoint that quietly auto-disabled is a
  silent data-loss bug otherwise.
- **`message.created` carries message text.** Your endpoint is handling user
  content — use HTTPS, and think about what your own logs retain.

## Next steps

- [Webhooks](/webhooks) — the full reference.
- [Event catalogue](/reference/events) — all 15 event types.
- [Idempotency](/backend/idempotency)
