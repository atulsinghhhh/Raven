# @corvidhq/chat — Browser SDK

`@corvidhq/chat` is Raven's browser SDK for real-time messaging. Connect, send,
listen — without writing a line of WebSocket code, a reconnect loop, a
heartbeat, or message-ordering logic.

It is separate from `@corvidhq/rtc` on purpose. Media and messaging have almost
nothing in common at the transport layer, and one SDK doing both would force
every video app to ship a message store and every chat app to ship WebRTC.
They compose cleanly when you want both — see
[examples/rtc-chat](../../examples/rtc-chat).

## Installation

```bash
npm install @corvidhq/chat
```

Chrome, Firefox, Safari, Edge (current versions). Native mobile is out of
scope for this package.

## Authentication

**Never mint a chat token in the browser, and never put a project API key
there.**

```
Your backend  ──(project API key)──►  Raven Control API
                                              │
                                              │  short-lived chat token
                                              ▼
                                      Your frontend
```

Your backend authenticates the user however it already does, then asks Raven
for a token scoped to that one user:

```js
// backend
import { Raven } from '@corvidhq/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const token = await raven.chat.createToken({
  userId: req.user.id,          // from YOUR session, never the request body
  conversations: [conversationId],
  expiresIn: 3600,
});
```

The SDK never calls the Control API to authenticate itself — it only ever
receives an already-minted token.

## Quick start

```js
import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({
  token: session.token,
  apiUrl: session.apiUrl,
});

await chat.connect({ room: 'conv_9WcQ4kRz1nB2xYtL' });

chat.on('message', (message) => {
  console.log(`${message.senderId}: ${message.text}`);
});

await chat.sendMessage({ text: 'Hello everyone!' });
```

`connect()` resolves once the **server has authenticated the socket**, not
merely when TCP opened — so a resolved `connect()` genuinely means you can
send.

## Configuration

```js
createChatClient({
  token,                        // required
  chatUrl,                      // optional — derived from apiUrl
  apiUrl,                       // optional — derived from chatUrl
  logLevel: 'silent',           // 'error' | 'warn' | 'info' | 'debug'
  autoReconnect: true,
  maxReconnectAttempts: 10,
  initialReconnectDelayMs: 500,
  maxReconnectDelayMs: 30_000,
  requestTimeoutMs: 15_000,
  onTokenExpiring: async () => (await fetch('/api/chat/token')).json().token,
});
```

Pass either `chatUrl` or `apiUrl` and the SDK derives the other, so the common
case is `createChatClient({ token, apiUrl })`.

`onTokenExpiring` is worth wiring up: without it, a long-lived tab's socket
simply closes when the token expires. With it, the SDK fetches a fresh token
shortly before expiry and reconnects transparently.

## Connection

```js
await chat.connect({ room: 'conv_…' });
await chat.connect({ rooms: ['conv_a', 'conv_b'] });
await chat.joinRoom('conv_c');
await chat.leaveRoom('conv_a');
await chat.reconnect();
await chat.disconnect();

chat.connectionState;  // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'
chat.userId;           // from the token — not settable
chat.id;               // connection id, for bug reports
chat.rooms;            // rooms currently joined
```

`failed` and `disconnected` mean different things: `failed` is terminal —
reconnect attempts are exhausted, or the failure is one retrying can't fix
(a revoked token). `disconnected` is an ordinary ended connection.

## Reconnection

Handled for you, and worth knowing what it does:

- Exponential backoff with **full jitter**, capped. Jitter matters: when a
  gateway restarts, every client wakes at the same instant, and without it
  they retry in lockstep and re-create the thundering herd.
- **Bounded.** After `maxReconnectAttempts` it reports `failed` rather than
  hammering a server that's already struggling.
- **No retry on `4401`/`4403`.** Retrying a rejected token is pointless.
- **Rooms are re-joined** on the new socket.
- **In-flight requests reject** rather than hanging until timeout.

```js
chat.on('reconnecting', (attempt) => showBanner(`Reconnecting… (${attempt})`));
chat.on('reconnected', () => hideBanner());
```

After a reconnect you should refetch what you missed — the WebSocket is not
the source of truth:

```js
chat.on('reconnected', async () => {
  const page = await chat.messages.list({ after: newestCursorYouHold });
  page.data.forEach(append);
});
```

`@corvidhq/react`'s store does this automatically.

## Messages

```js
await chat.sendMessage({
  text: 'Hello',
  replyTo: 'msg_…',
  clientMessageId: 'client_123',
  metadata: { source: 'mobile' },
});

const page = await chat.messages.list({ limit: 50 });
const older = await chat.messages.list({ before: page.nextCursor });
const newer = await chat.messages.list({ after: page.previousCursor });

await chat.messages.get('msg_…');
await chat.messages.thread('msg_…');
await chat.messages.update('msg_…', { text: 'Updated' });
await chat.messages.delete('msg_…');
await chat.messages.addReaction('msg_…', '👍');
await chat.messages.removeReaction('msg_…', '👍');
```

`sendMessage()` resolves only after the message is durably stored, and returns
the server's canonical id and timestamp. A `clientMessageId` is attached
automatically, so the SDK's own retries can't duplicate a message.

## Events

```js
const unsubscribe = chat.on('message', handler);
unsubscribe();
```

`on()` returns an unsubscribe function rather than the client, because chat
handlers are usually registered in component effects where cleanup is the
common case. `off(event, handler)` and `once()` also exist.

| Event | Payload |
| --- | --- |
| `message` | `ChatMessage` — including your own, echoed back |
| `messageUpdated` | `ChatMessage` |
| `messageDeleted` | `{ messageId, roomId, deletedAt, deletedBy }` |
| `reactionAdded` / `reactionRemoved` | `{ messageId, roomId, userId, emoji, at }` |
| `typing` | `{ userId, roomId, isTyping }` |
| `presence` | `{ userId, roomId, status, at }` |
| `read` | `{ userId, roomId, messageId, at }` |
| `connectionStateChanged` | `ChatConnectionState` |
| `connected` / `disconnected` / `reconnecting` / `reconnected` | — |
| `error` | `RavenChatError` |

## Presence, typing, read state

```js
await chat.setPresence('away');
await chat.getPresence();

await chat.startTyping();   // safe per keystroke — throttled and self-stopping
await chat.stopTyping();

await chat.markAsRead('msg_…');
await chat.getReadState();
await chat.getReadReceipts();
```

## Attachments

```js
const attachment = await chat.attachments.upload(file);
await chat.sendMessage({ type: 'attachment', attachmentId: attachment.id });

const { url } = await chat.attachments.getDownloadUrl('att_…');
```

Bytes go straight to object storage over a signed URL — never through Raven's
API or the WebSocket. See [../chat/attachments.md](../chat/attachments.md).

## Errors

```js
import {
  RavenChatError,              // base — one catch covers everything
  RavenChatConnectionError,
  RavenChatAuthenticationError,
  RavenChatPermissionError,
  RavenMessageError,
  RavenRateLimitError,
  RavenRoomError,
  RavenAttachmentError,
  isRavenChatError,
} from '@corvidhq/chat';

try {
  await chat.sendMessage({ text });
} catch (error) {
  if (error instanceof RavenRateLimitError) {
    await sleep((error.retryAfterSeconds ?? 5) * 1000);
  } else if (error instanceof RavenChatAuthenticationError) {
    await refreshToken();
  }
}
```

You will never see a raw `CloseEvent`, a Postgres constraint name, or a Redis
timeout. Those are infrastructure Raven is supposed to be hiding.

An error correlated to a call you made rejects *that promise*. Connection-level
errors fire the `error` event.

## React

`@corvidhq/react` ships chat hooks alongside the existing RTC ones:

```jsx
import { RavenChat, useMessages, useTyping, usePresence } from '@corvidhq/react';

function App({ session }) {
  return (
    <RavenChat token={session.token} apiUrl={session.apiUrl} room={session.roomId}>
      <ChatPanel />
    </RavenChat>
  );
}

function ChatPanel() {
  const { messages, send, loadMore, hasMore } = useMessages();
  const { typingUsers, onInput } = useTyping();
  const presence = usePresence();
  // …
}
```

Hooks: `useChat`, `useChatClient`, `useChatConnectionState`, `useChatError`,
`useMessages`, `usePresence`, `useTyping`, `useReactions`, `useReadReceipts`.

Each reads one slice of the store, so a component rendering typing indicators
doesn't re-render on every incoming message.

`<RavenChat>` and `<RavenRoom>` nest — that's how you build a video call with a
chat panel.

## What the SDK does not expose

No `WebSocket`. No frame types. No Redis, Postgres, or transport types. No
internal database ids — every id you see is a `msg_…`, `conv_…`, `att_…`, or
`ccn_…`. Cursors are opaque and decode to public ids only.

If you find yourself needing one of those to build something, that's a gap in
this API worth reporting rather than working around.

## Bundle size

~34 KB unminified, ~10 KB gzipped, zero runtime dependencies.

## Versioning

The chat API is versioned at `/v1`. Frame types are additive; unknown frames
and unknown message types are ignored rather than rejected, so a newer server
never breaks an older client.
