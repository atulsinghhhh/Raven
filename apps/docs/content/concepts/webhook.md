---
title: Webhook
description: A signed HTTP POST to your backend when something happens. Retried, environment-scoped, and deduplicable.
---

A webhook endpoint is a URL you register. Raven POSTs each subscribed event
to it, signed.

## Why it exists

So your backend can react without polling, and without depending on a
browser tab being open.

## Registered per environment

An endpoint belongs to exactly one [environment](/concepts/environment). A
staging endpoint never receives production events. Getting that wrong would
mean real customer data landing on whatever URL someone pointed at their
laptop, so it is checked before anything is queued.

## The envelope

```json
{
  "id": "evt_GSyoZrH7qF3tZms0QsW4Gw",
  "type": "message.created",
  "projectId": "3e48ccb1-...",
  "environment": "PRODUCTION",
  "createdAt": "2026-09-08T12:00:00.000Z",
  "data": { "message": { "id": "msg_3xR…", "roomId": "conv_9WcQ…", "senderId": "alice", "text": "Hello" } }
}
```

Plus three headers: `Raven-Signature`, `Raven-Event-Id`, `Raven-Event-Type`.

## Signed, and you must verify

`Raven-Signature` is `t=<unix>,v1=<hmac-sha256>` over `"<timestamp>.<raw body>"`.
The timestamp is *inside* the signed payload, so a captured delivery cannot
be replayed with a fresh timestamp bolted on.

An unverified endpoint accepts anything anyone POSTs to it, and yours is a
public URL that can create side effects. See
[Webhooks](/webhooks#verifying-a-delivery) for a reference verifier.

## Delivery is asynchronous

A message is stored and fanned out to connected clients *before* its
webhook is queued. A slow endpoint costs your users nothing.

Retries are exponential — 10s, 20s, 40s, 80s, 160s, 320s — then the
delivery is marked failed. An endpoint failing 50 consecutive deliveries is
auto-disabled so a dead URL stops burning retry budget.

## Assume duplicates, do not assume order

A delivery can succeed while its response is lost. Dedupe on
`Raven-Event-Id`, which is stable across every retry. Retries also mean a
delayed event can arrive after a later one, so order by `createdAt` rather
than arrival.

## Minimal example

```ts
app.post('/hooks/raven', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verify(req.body.toString('utf8'), req.header('raven-signature')!, process.env.RAVEN_WEBHOOK_SECRET!)) {
    return res.sendStatus(400);
  }
  res.sendStatus(200);              // ack fast
  void enqueue(JSON.parse(req.body.toString('utf8')));   // work later
});
```

The delivery timeout is 5 seconds. Anything slower is recorded as a failure
and retried — turning slow processing into duplicates.

## Related

- [Webhooks](/webhooks) — configuration, verification, retries in full.
- [Handle webhooks](/guides/handle-webhooks) — a working receiver.
- [Event catalogue](/reference/events)
