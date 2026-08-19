---
title: Chat Troubleshooting
description: Common gotchas, and how to confirm Chat's own guarantees are behaving the way they're documented to.
---

## "My retried send created a duplicate message"

It shouldn't — a retried send is deduped server-side. If you're seeing
duplicates, check that you're retrying the *same* `sendMessage` call
(with its own client-generated idempotency handling) rather than
constructing a new one with fresh state each attempt. If it reproduces
reliably, that's a real bug worth reporting, not expected behavior.

## "I reconnected and missed messages"

The WebSocket delivers what happens while you're connected — it isn't
responsible for backfilling a gap. After `reconnected` fires, pull
what you missed explicitly:

```ts
chat.on('reconnected', async () => {
  const page = await chat.messages.list({ room, after: lastSeenCursor });
});
```

See [Message History](/chat/message-history) for cursor semantics.

## "A message I sent isn't showing up for other users"

Check `error` events first — a message rejected server-side (bad scope,
wrong conversation, banned content type) never round-trips as a
`message` event, so a UI that only listens for success can silently
drop the failure. Confirm your token actually carries `chat:send` for
that conversation — see [Authentication](/chat/authentication).

## "Deleting/editing someone else's message fails"

Only the author can edit. Deleting someone else's message requires
`chat:moderate` (a `MODERATOR` or `ADMIN` role) — see
[Moderation](/chat/moderation). A `PERMISSION_DENIED`-shaped error here
is the server working as intended, not a bug.

## "Presence shows someone as online after they closed the tab"

Presence reflects an active connection, not application state — a
closed tab without a clean disconnect is only detected once its
presence entry's TTL expires (up to 45 seconds), not instantly. See
[Presence](/chat/presence) for exactly how the TTL/heartbeat works.

## Next

- [Presence](/chat/presence)
- [WebSocket Protocol](/chat/websocket) — if you're debugging at the
  transport level directly.
