# @corvidhq/chat

Raven's browser chat SDK — durable, ordered messaging with presence,
typing indicators, read receipts, reactions, threads and attachments.
Connect, send and receive without writing a line of WebSocket code.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Install

```bash
npm install @corvidhq/chat
```

## Use

The chat token is minted by your backend (`POST /v1/chat/tokens`) and is a
separate credential from an RTC token — neither works on the other plane.

```ts
import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({
  token: grant.token,
  apiUrl: grant.apiUrl,
});

await chat.connect({ room: 'room_123' });

chat.on('message', (message) => render(message));

await chat.sendMessage({ text: 'Hello' });
```

Postgres is the source of truth, so history survives a reconnect and
messages arrive in a defined order rather than whatever the socket
delivered.

## Exports

`createChatClient`, `ChatClient`, `MessagesApi`, `AttachmentsApi`,
`isRavenChatError`, and the message/presence/reaction types.

## Documentation

- [Chat SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/chat.md)
- [Chat overview](https://github.com/atulsinghhhh/Raven/blob/main/docs/chat/overview.md) · [architecture](https://github.com/atulsinghhhh/Raven/blob/main/docs/chat/architecture.md) · [WebSocket protocol](https://github.com/atulsinghhhh/Raven/blob/main/docs/chat/websocket.md)
- Presence · typing · read receipts · reactions · threads · attachments — one page each under [`docs/chat/`](https://github.com/atulsinghhhh/Raven/tree/main/docs/chat)
- Runnable example: [`examples/chat`](https://github.com/atulsinghhhh/Raven/tree/main/examples/chat)

## License

MIT
