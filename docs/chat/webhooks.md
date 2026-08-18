# Raven Chat — Webhooks

Webhooks let your backend react to chat events without polling. Register a URL
in the dashboard (**Webhooks**) or via the API, and Raven POSTs each event to
it.

Webhooks are **project-scoped, not chat-scoped**. Chat is the only producer
today, but later phases publish through this same pipeline rather than
standing up a second one.

## Events

| Event | Fires when |
| --- | --- |
| `message.created` | A message is stored |
| `message.updated` | A message is edited |
| `message.deleted` | A message is soft-deleted |
| `reaction.added` | A reaction is added |
| `reaction.removed` | A reaction is removed |
| `room.created` | A conversation is created |
| `participant.joined` | A member joins |
| `participant.left` | A member leaves |

Subscribe to specific events, or leave the list empty for all of them.

## The payload

```json
{
  "id": "evt_GSyoZrH7qF3tZms0QsW4Gw",
  "type": "message.created",
  "projectId": "3e48ccb1-…",
  "createdAt": "2026-08-18T12:00:00.000Z",
  "data": {
    "message": {
      "id": "msg_3xR…",
      "roomId": "conv_9WcQ…",
      "senderId": "alice",
      "text": "Hello everyone!",
      "createdAt": "2026-08-18T12:00:00.000Z"
    }
  }
}
```

Headers:

| Header | Contains |
| --- | --- |
| `Raven-Signature` | `t=<unix>,v1=<hmac-sha256>` |
| `Raven-Event-Id` | The `evt_…` id — dedupe on this |
| `Raven-Event-Type` | The event type |

**`message.created` includes message text.** That's the point of the event,
but it means your webhook endpoint is handling user content: use HTTPS, and
think about what your logs retain.

## Verifying a delivery

Do this. An unverified webhook endpoint accepts anything anyone POSTs to it,
and yours is a public URL that creates messages in your system.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
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

Three things that are easy to get wrong:

**Sign the raw body, not a re-serialised object.** `JSON.parse` then
`JSON.stringify` can reorder keys and change whitespace, and the signature
won't match. Capture the raw bytes before your JSON middleware touches them.

**The timestamp is inside the signed payload**, not merely alongside it. That's
what makes the replay check meaningful — an attacker can't bolt a fresh
timestamp onto a captured request.

**Use a constant-time compare.** A naive `===` leaks the expected signature
through timing to anyone willing to make enough attempts.

## Retries

Delivery is asynchronous and never blocks the message path. A message is
stored and fanned out to connected clients before the webhook is even queued —
a slow endpoint costs your users nothing.

Any non-2xx response, a timeout, or a connection failure is retried with
exponential backoff: 10s, 20s, 40s, 80s, 160s, 320s, then marked `FAILED`.

After 50 consecutive failures across all deliveries, the endpoint is
**auto-disabled** so a permanently dead URL stops burning retry budget forever.
Fix it and re-enable from the dashboard; re-enabling clears the failure count.

Delivery history — attempts, response status, truncated errors — is on the
endpoint's detail view.

## Idempotency

**Assume you will receive duplicates.** A delivery can succeed while the
response is lost, or the worker can restart mid-batch.

Dedupe on `Raven-Event-Id` (`evt_…`). It's stable across every retry of the
same event.

## Ordering

Not guaranteed. Retries mean a delayed event can arrive after a later one.
Order by `createdAt` in the payload rather than by arrival, and don't build
state machines that assume sequence.

## Responding

Return 2xx as fast as you can and do the real work asynchronously. The
delivery timeout is 5 seconds (`WEBHOOK_TIMEOUT_MS`); anything slower is
recorded as a failure and retried, so slow processing turns into duplicates.

## Security

**Signing secrets are shown once**, at creation, and never returned again. Like
an API key secret — but unlike one, Raven does store it, because signing each
delivery requires it. Rotation is delete-and-recreate.

**SSRF is partially mitigated.** Raven refuses obvious internal targets:
non-HTTP schemes, loopback, and RFC 1918 / link-local addresses (outside local
development). Production additionally requires `https://`.

This is **hostname-level only** — it does not resolve DNS, so a hostname that
resolves to a private IP still gets through, as does a redirect to one. A
production deployment should egress-filter the delivery worker. This is a
known limitation, stated rather than implied.

## Configuration

```bash
WEBHOOK_MAX_ATTEMPTS=6
WEBHOOK_BACKOFF_BASE_MS=10000
WEBHOOK_TIMEOUT_MS=5000
WEBHOOK_POLL_INTERVAL_MS=2000
WEBHOOK_BATCH_SIZE=20
WEBHOOK_DISABLE_AFTER_FAILURES=50
```

The worker polls Postgres on an interval and holds a Redis lock, so it's safe
to run on every instance in a fleet — only one delivers at a time, and the
lock has a TTL so an instance dying mid-batch doesn't wedge the queue. The
worst case is one batch retried, which is exactly why every event carries an
idempotent id.
