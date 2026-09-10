---
title: Build a chat application
description: Durable history, presence, typing indicators, and the ordering guarantee that makes them agree.
---

## What we're building

A chat channel: messages that survive a reload, a member list that shows who
is online, typing indicators, and history that pages backwards.

## Prerequisites

- A project and an API key — [API credentials](/get-started/api-credentials).
- `npm install @ravenkash/chat` (add `@ravenkash/react` for the hooks).

## Implementation

### 1. Create a conversation, server-side

A client cannot invent a conversation or add itself to one. Your backend
does both:

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL!, // https://api.ravenstack.online
});

const conversation = await raven.chat.createConversation({
  name: 'support-room-42',
  type: 'CHANNEL',
  members: [
    { userId: 'alice', role: 'ADMIN' },
    { userId: 'bob' },
  ],
});
```

### 2. Mint a chat token

```ts
app.post('/chat-token', async (req, res) => {
  const token = await raven.chat.createToken({
    userId: req.user.id,                       // from YOUR session, never the request body
    conversations: [conversation.publicId],
    scopes: ['chat:read', 'chat:send'],
    expiresIn: 3600,
  });
  res.json(token);   // { token, chatUrl, apiUrl, conversations, expiresAt, ... }
});
```

### 3. Connect and send

<Tabs>
<Tab title="Web">

```ts
import { createChatClient } from '@ravenkash/chat';

const minted = await fetch('/chat-token', { method: 'POST' }).then((r) => r.json());

const chat = createChatClient({
  token: minted.token,
  apiUrl: minted.apiUrl,
  chatUrl: minted.chatUrl,
  onTokenExpiring: async () => {
    const fresh = await fetch('/chat-token', { method: 'POST' }).then((r) => r.json());
    return fresh.token;
  },
});

await chat.connect({ room: minted.conversations[0] });

chat.on('message', (message) => appendToUi(message));

await chat.sendMessage({
  text: 'Hello everyone',
  clientMessageId: crypto.randomUUID(),
});
```

`onTokenExpiring` is the difference between a chat panel that works all day
and one that silently stops at the hour mark.

</Tab>
<Tab title="React">

```tsx
'use client';
import { RavenChat, useMessages, useTyping, usePresence } from '@ravenkash/react/chat';

function Panel({ minted }) {
  return (
    <RavenChat token={minted.token} apiUrl={minted.apiUrl} room={minted.conversations[0]}>
      <Messages />
      <Composer />
    </RavenChat>
  );
}

function Messages() {
  const { messages, loadMore, hasMore } = useMessages();
  return (
    <>
      {hasMore && <button onClick={loadMore}>Load earlier</button>}
      {messages.map((m) => (
        <p key={m.id}>
          <b>{m.senderId}</b> {m.text}
        </p>
      ))}
    </>
  );
}
```

</Tab>
<Tab title="Flutter">

```dart
final chat = RavenChat(token: minted.token, apiUrl: minted.apiUrl);
await chat.connect(minted.conversations.first);

chat.messages.listen((m) => setState(() => _messages.add(m)));
await chat.send('Hello everyone');
```

</Tab>
</Tabs>

### 4. Page history backwards

```ts
const page = await chat.messages.list({ limit: 50 });
// newest first
const older = await chat.messages.list({ before: page.nextCursor, limit: 50 });
```

Cursors are opaque. Do not build or parse one — an unreadable cursor
returns `INVALID_CURSOR` rather than silently resetting to page one, which
is what makes an infinite scroll safe to retry.

### 5. Typing and presence

```ts
composer.addEventListener('input', () => void chat.startTyping());
composer.addEventListener('blur', () => void chat.stopTyping());

chat.on('typing', (e) => showTyping(e.userId, e.isTyping));
chat.on('presence', (e) => setOnline(e.userId, e.status === 'online'));

await chat.setPresence('online');
```

Both are ephemeral — they never touch Postgres, and they expire on a TTL
(7s for typing, 45s for presence). Call `startTyping()` on input and let it
lapse rather than trying to manage a timer yourself.

## How it works

**The server assigns order, and the sender re-renders from it.**
`sendMessage()` resolves with the stored message — that is the durability
signal. Separately, the sender *also* receives the fan-out `message` event,
like everyone else. Render from the event, not from the resolve value, and
every client shows the same order even with skewed clocks.

**Delivery is at-least-once, so send an id.** `clientMessageId` is deduped
on `(conversation, sender, clientMessageId)` with a unique constraint
behind it. The result's `deduplicated` flag tells you a retry was a replay.

**Authorization is two checks, not one.** What the token allows, and what
membership allows. A token can only narrow the user's conversation role,
never widen it — so asking for `chat:moderate` as a plain member grants
nothing. See [Permissions](/authentication/permissions).

**Presence expiry *is* the offline transition.** There is no "user went
offline" message; the Redis key lapses and that is the signal. Which is why
a heartbeat that stops for 45 seconds shows as offline, and why presence is
honest about a browser that crashed.

## Production considerations

- **Refresh tokens.** Wire `onTokenExpiring` in the SDK, or a chat panel
  dies after an hour. This is the single most common chat bug.
- **Assume duplicates in your own store too.** If you also persist messages
  from webhooks, dedupe on the message id.
- **Text is capped at 4000 characters** and metadata at 4096 bytes. Validate
  in your composer so the user finds out before they press send.
- **Attachments need object storage configured.** Without a bucket the API
  returns `RAVEN_NOT_CONFIGURED` rather than half-working. Check
  [Known limitations](/reference/known-limitations) before promising them.
- **`CORS_ORIGIN` must list your origin**, or the WebSocket upgrade is
  rejected with close code `4403`.
- **Set retention deliberately.** Messages are kept forever by default.

## Next steps

- [Chat overview](/chat) · [Messages](/chat/messages) · [Chat events](/chat/events)
- [WebSocket protocol](/chat/websocket) — if you need a client Raven does not ship.
