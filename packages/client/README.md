# @corvidhq/client

Raven for the browser, with RTC and chat behind one object.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

This is a **facade, not a third implementation**: `raven.rtc` is a real
`RTCClient` from [`@corvidhq/rtc`](https://www.npmjs.com/package/@corvidhq/rtc)
and `raven.chat` is a real `ChatClient` from
[`@corvidhq/chat`](https://www.npmjs.com/package/@corvidhq/chat). Every
method, event and type documented for those packages applies here
unchanged, because they *are* those objects.

> **Only want calls?** Use `@corvidhq/rtc` directly — it pulls in no
> messaging code. This package is for apps that want both planes without
> wiring two clients, and it mirrors the shape `@corvidhq/react-native`
> gives mobile, so the same mental model works on both.

## Install

```bash
npm install @corvidhq/client
```

## Use

RTC and chat credentials are independent, so supply whichever planes your
app actually uses:

```ts
import { Raven } from '@corvidhq/client';

new Raven({ token, endpoint });                        // calls only
new Raven({ chatToken, chatApiUrl });                  // messaging only
new Raven({ token, endpoint, chatToken, chatApiUrl }); // both
```

```ts
const raven = new Raven({ token, endpoint, chatToken, chatApiUrl });

const room = await raven.join('room_123');
await room.enableCamera();

await raven.chat!.connect({ room: 'room_123' });
await raven.chat!.sendMessage({ text: 'Hello' });
```

Every value comes from your backend's token-mint response — none should be
hand-constructed.

### Live streaming

`raven.live` is available on every instance regardless of the credentials
the instance was built with: host, co-host and viewer tokens are minted
per stream, per role, by your backend.

```ts
const stream = await raven.live.join(credentials);
if (stream.isHost) await stream.room.enableCamera();
```

## Exports

`Raven`, `createRaven`, `LiveStream`, `joinLiveStream`, plus re-exported
`Room`, `RTCClient`, `ChatClient`, `ChatMessage`, `RTCError` types for
convenience.

## Documentation

- [Browser SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk.md) · [Chat SDK](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/chat.md)
- Runnable example: [`examples/rtc-chat`](https://github.com/atulsinghhhh/Raven/tree/main/examples/rtc-chat)

## License

MIT
