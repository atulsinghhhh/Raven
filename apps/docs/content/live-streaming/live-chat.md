---
title: Live Chat
description: Every stream gets a real Livqeno Chat conversation, attached automatically — not a second messaging system.
---

Creating a stream creates and attaches a Chat
[conversation](/chat/conversations) in the same call — you never call
`raven.chat.createConversation` yourself for a live stream. The
attached conversation works exactly like any other:

<Tabs>
<Tab title="Web">

```ts
await stream.chat.sendMessage({ text: 'Hey everyone!' });
stream.chat.on('message', (message) => console.log(message.senderId, message.text));
```

</Tab>
<Tab title="React">

```tsx
import { useMessages } from '@ravenkash/react';

function LiveChatPanel() {
  const { messages, send } = useMessages(); // works inside <RavenLiveStream> — no separate hook
  return (
    <div>
      {messages.map((m) => <p key={m.id}>{m.senderId}: {m.text}</p>)}
      <input onKeyDown={(e) => e.key === 'Enter' && send(e.currentTarget.value)} />
    </div>
  );
}
```

</Tab>
<Tab title="React Native">

```ts
await stream.chat!.send('Hey everyone!');
stream.chat!.on('message', (message) => console.log(message.senderId, message.text));
```

</Tab>
<Tab title="Flutter">

```dart
await stream.chat?.send('Hey everyone!');
stream.chat?.messages.listen((message) => print('${message.senderId}: ${message.text}'));
```

</Tab>
</Tabs>

`stream.chat` is a real chat client on every SDK — the same object
[Chat](/chat) itself documents, not a wrapper with a smaller API. On
React there's deliberately no `useLiveStreamChat()` — `useMessages()`
and every other chat hook already work inside `<RavenLiveStream>`.

## Roles carry over from hosting

Joining as `HOST`/`CO_HOST` mints a chat token with `ADMIN`/`MODERATOR`
scope on the attached conversation; joining as `VIEWER` mints one with
`MEMBER` scope. See [Authentication](/live-streaming/authentication)
and [Chat → Moderation](/chat/moderation) for what each scope allows.

## No chat for a stream that hasn't been joined

`stream.chat` is only set if the credentials you joined with included a
`chat` field — which they always do for streams created through the
Live Streaming API. If you're composing `LiveStream.join()` with
hand-built credentials that omit it, `stream.chat` is `undefined` and
[`stream.react()`](/live-streaming/reactions) throws rather than
silently no-op-ing.

## Next

- [Reactions](/live-streaming/reactions)
- [Moderation](/live-streaming/moderation)
