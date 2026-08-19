---
title: Chat Quickstart
description: Install, authenticate, connect, and send your first message.
---

## 1. Install

```bash
npm install @corvidhq/chat
```

## 2. Create a conversation (once, from your backend)

```ts
import { Raven } from '@corvidhq/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

const conversation = await raven.chat.createConversation({
  name: 'support-room-42',
  members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
});
```

## 3. Authenticate — mint a token per user

```ts
const token = await raven.chat.createToken({
  userId: 'alice',
  conversations: [conversation.publicId],
});
```

## 4. Connect from the client

```ts
import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({ token: token.token, apiUrl: token.apiUrl });
await chat.connect({ room: conversation.publicId });
```

## 5. Send a message

```ts
await chat.sendMessage({ text: 'Hello everyone!' });
```

## 6. Receive messages

```ts
chat.on('message', (message) => console.log(message.senderId, message.text));
```

You receive your own messages back too — render the same
server-ordered row everyone else does, rather than an optimistic local
copy.

## 7. Disconnect

```ts
await chat.disconnect();
```

That's a working conversation. For the full authorization model, see
[Chat → Authentication](/chat/authentication). Building a live
community rather than a support thread? See
[Raven Live Streaming](/live-streaming) — it attaches a Raven Chat
conversation to every stream automatically.
