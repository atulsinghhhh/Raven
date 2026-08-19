---
title: Chat Quickstart
description: Install, authenticate, connect, and send your first message — on every supported SDK.
---

What you'll build: a conversation two users can send messages into, with
one seeing the other's messages arrive live.

**Prerequisites:** a Raven project and a project API key (see
[API Keys](/authentication)) — conversations are created and chat tokens
are minted with it, server-side, and never in a browser or app.

## 1. Install

<Tabs>
<Tab title="Web">

```bash
npm install @corvidhq/chat
```

</Tab>
<Tab title="React">

```bash
npm install @corvidhq/chat @corvidhq/react
```

</Tab>
<Tab title="React Native">

```bash
npm install @corvidhq/react-native @corvidhq/chat
```

Chat is optional on React Native — install it alongside
`@corvidhq/react-native` only if your app sends messages. See
[React Native SDK](/sdk/react-native).

</Tab>
<Tab title="Flutter">

```yaml
dependencies:
  raven_chat:
    path: ../path/to/your-checkout/sdks/flutter/raven_chat
```

Pure Dart, no native code — a messaging-only app never pulls in a
WebRTC stack.

</Tab>
</Tabs>

## 2. Create a conversation (once, from your backend)

<Tabs>
<Tab title="Node.js">

```ts
import { Raven } from '@corvidhq/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const conversation = await raven.chat.createConversation({
  name: 'support-room-42',
  members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
});
```

</Tab>
<Tab title="Python">

```python
from raven import Raven, CreateConversationParams

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])
conversation = raven.chat.create_conversation(CreateConversationParams(name="support-room-42"))
```

</Tab>
</Tabs>

## 3. Authenticate — mint a token per user

<Tabs>
<Tab title="Node.js">

```ts
const token = await raven.chat.createToken({
  userId: 'alice',
  conversations: [conversation.publicId],
});
```

</Tab>
<Tab title="Python">

```python
from raven import CreateChatTokenParams

token = raven.chat.create_token(
    CreateChatTokenParams(user_id="alice", conversations=[conversation["publicId"]])
)
```

</Tab>
</Tabs>

## 4. Connect from the client

<Tabs>
<Tab title="Web">

```ts
import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({ token: token.token, apiUrl: token.apiUrl });
await chat.connect({ room: conversation.publicId });
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { RavenChat, useChatConnectionState } from '@corvidhq/react';

function ChatPanel({ chatToken, apiUrl, room }) {
  return (
    <RavenChat token={chatToken} apiUrl={apiUrl} room={room}>
      <Thread />
    </RavenChat>
  );
}

function Thread() {
  const state = useChatConnectionState(); // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'
  return <p>Status: {state}</p>;
}
```

`<RavenChat>` connects on mount and disconnects on unmount — no
separate `connect()` call to make yourself. It's the chat-side
equivalent of `<RavenRoom>`, and nests with it for a call with a chat panel.

</Tab>
<Tab title="React Native">

```ts
import { Raven } from '@corvidhq/react-native';

const raven = new Raven({ chatToken: token.token, chatApiUrl: token.apiUrl });
await raven.chat!.connect('support-room-42');
```

`raven.chat` is present only when a `chatToken` was supplied — pair it
with `token`/`endpoint` for calls-plus-chat, or omit those for a
messaging-only app. `connect(room)` takes a plain string, not
`{ room }` — the client already exists on `raven`, so the only
remaining question is which room.

</Tab>
<Tab title="Flutter">

```dart
import 'package:raven_chat/raven_chat.dart';

final chat = RavenChat(token: token.token, apiUrl: token.apiUrl);
await chat.connect('support-room-42');
```

</Tab>
</Tabs>

## 5. Send a message

<Tabs>
<Tab title="Web">

```ts
await chat.sendMessage({ text: 'Hello everyone!' });
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useMessages } from '@corvidhq/react';

function Composer() {
  const { send } = useMessages();
  return (
    <input onKeyDown={(e) => e.key === 'Enter' && send(e.currentTarget.value)} />
  );
}
```

</Tab>
<Tab title="React Native">

```ts
await raven.chat!.send('Hello everyone!');
```

Convenience for `sendMessage({ text })` — the common case on a phone.
Everything else on `ChatClient` (history, reactions, presence) is
available on `raven.chat` unchanged.

</Tab>
<Tab title="Flutter">

```dart
await chat.send('Hello everyone!');
```

</Tab>
</Tabs>

## 6. Receive messages

<Tabs>
<Tab title="Web">

```ts
chat.on('message', (message) => console.log(message.senderId, message.text));
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useMessages } from '@corvidhq/react';

function MessageList() {
  const { messages } = useMessages(); // oldest-first — render order
  return messages.map((m) => <p key={m.id}>{m.senderId}: {m.text}</p>);
}
```

</Tab>
<Tab title="React Native">

```ts
raven.chat!.on('message', (message) => console.log(message.senderId, message.text));
```

</Tab>
<Tab title="Flutter">

```dart
chat.messages.listen((message) => print('${message.senderId}: ${message.text}'));
```

A stream, not an event emitter — see [Flutter SDK](/sdk/flutter#idiomatic-dart-identical-concepts) for why.

</Tab>
</Tabs>

You receive your own messages back too — render the same
server-ordered row everyone else does, rather than an optimistic local
copy.

## 7. Disconnect

<Tabs>
<Tab title="Web">

```ts
await chat.disconnect();
```

</Tab>
<Tab title="React">

Unmount `<RavenChat>` — it disconnects for you.

</Tab>
<Tab title="React Native">

```ts
await raven.leave();    // leaves any RTC room, keeps chat connected
await raven.dispose();  // tears down everything, including chat
```

</Tab>
<Tab title="Flutter">

```dart
chat.dispose();
```

</Tab>
</Tabs>

## What Raven handles vs. what you handle

**Raven handles:** the WebSocket connection, reconnection with backoff
and catch-up, message ordering and durability, and idempotent retries.

**You handle:** minting tokens from your own authenticated backend
session, and the UI around messages/typing/presence.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `chat:send` scope missing | Token was minted without it, or the role doesn't grant it. | Check the member's role — see [Members](/chat/members). |
| Message never arrives for other users | Rejected server-side; a rejection never round-trips as a `message` event. | Listen for `error` too, not just `message` — see [Troubleshooting](/chat/troubleshooting). |
| `senderId` in the request is ignored | A browser chat token can't set it. | Expected — see [Messages](/chat/messages#the-sender-is-never-yours-to-choose). |

## Production notes

- Never call `raven.chat.createConversation()`/`createToken()` (or any
  `@corvidhq/server`/`raven-sdk` method) from a browser or app.
- Derive `userId` from your own authenticated session — a chat token
  minted for the wrong user lets them send as someone else.
- `clientMessageId` is attached automatically if you don't supply one,
  so retries from the SDK itself are already safe. Supply your own only
  when *you* control the retry (a job queue, an offline outbox).

## Related

- [Chat → Overview](/chat) — the authorization model behind this.
- [Messages](/chat/messages) — idempotency, editing, deleting.
- [Presence](/chat/presence), [Typing Indicators](/chat/typing), [Reactions](/chat/reactions).
- Need a call alongside the conversation? See [RTC](/rtc) — the two planes are independent.
