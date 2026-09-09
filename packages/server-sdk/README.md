# @ravenkash/server

Raven's **backend** SDK — mint short-lived RTC and chat tokens, manage
rooms and live streams, and read connection/error diagnostics.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

> **Never import this in a browser.** It holds a permanent project API key.
> The browser gets a short-lived token that *this* SDK mints.

## Install

```bash
npm install @ravenkash/server
```

## Use

Identity comes from **your** session — never from the request body, or any
caller can claim to be anyone.

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY! });

const grant = await raven.tokens.create({ room: roomId, identity: 'user-42' });
// grant = { token, endpoint, iceServers, telemetryUrl, expiresAt, ... }
```

Hand `grant` to your frontend, which passes it to `@ravenkash/rtc`.

## Errors

```ts
import { RavenError, isRavenError } from '@ravenkash/server';
```

Every failure carries the API's error code and HTTP status, so you branch
on the cause rather than parse a message. Codes are listed in
[docs/error-codes.md](https://github.com/atulsinghhhh/Raven/blob/main/docs/error-codes.md).

## Documentation

- [TypeScript backend SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/server/typescript.md)
- [Server SDK security model](https://github.com/atulsinghhhh/Raven/blob/main/docs/security/server-sdk.md)
- Runnable example: [`examples/node-server`](https://github.com/atulsinghhhh/Raven/tree/main/examples/node-server)

Python backend? See [`raven-sdk`](https://pypi.org/project/raven-sdk/).

## License

MIT
