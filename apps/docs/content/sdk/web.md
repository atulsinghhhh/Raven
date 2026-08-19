---
title: TypeScript / Web SDK
description: Installing @corvidhq/rtc, @corvidhq/chat, and @corvidhq/client; browser support; and using them from Next.js.
---

Raven ships three browser packages: `@corvidhq/rtc` for calls,
`@corvidhq/chat` for messaging, and `@corvidhq/client` for both behind one
object. This page covers which to install, browser support, and
framework-specific usage — the full APIs live in
[RTC → Overview](/rtc) and [Chat → Overview](/chat).

## Install

> **Not published to npm yet.** The commands below are what installation
> will look like once these packages are released. Until then, install
> from a local checkout — see [Installing from source](/getting-started/installing-from-source).

Pick the package that matches what you're building:

| You want | Install | Import |
|---|---|---|
| Calls only | `@corvidhq/rtc` | `createRTCClient` |
| Messaging only | `@corvidhq/chat` | `createChatClient` |
| Both | `@corvidhq/client` | `createRaven` |

```bash
npm install @corvidhq/rtc          # calls
npm install @corvidhq/chat         # messaging
npm install @corvidhq/client       # both, behind one object
```

`@corvidhq/rtc` and `@corvidhq/chat` are independent packages — neither
depends on the other, and either can fail without affecting the other.
Install only what you use; `@corvidhq/rtc` alone is ~6 KB gzipped and
pulls in no messaging code.

### Calls and messaging together — `@corvidhq/client`

If your app does both, `@corvidhq/client` wires the two clients from one
config so you aren't managing two objects and two token lifecycles:

```ts
import { createRaven } from '@corvidhq/client';

// Every value here comes from your backend's token-mint response.
// Never mint a token in the browser.
const raven = createRaven({
  token: rtc.token,           // POST /v1/rtc/tokens
  endpoint: rtc.endpoint,
  iceServers: rtc.iceServers,
  chatToken: chat.token,      // POST /v1/chat/tokens
  chatApiUrl: chat.apiUrl,
});

const room = await raven.join('room_123');
await room.enableCamera();
await room.enableMicrophone();

await raven.chat!.connect({ room: 'room_123' });
raven.chat!.on('message', (m) => console.log(`${m.senderId}: ${m.text}`));
await raven.chat!.sendMessage({ text: 'Hello everyone!' });

// Leaving the call keeps chat connected; dispose() tears down both.
await raven.leave();
await raven.dispose();
```

This is a facade, not a third implementation: `raven.rtc` **is** an
`RTCClient` and `raven.chat` **is** a `ChatClient`. Every method, event,
and type documented in [RTC](/rtc) and [Chat](/chat)
works here unchanged. It mirrors the shape
[`@corvidhq/react-native`](/sdk/react-native) already gives mobile, so the
same mental model carries across platforms.

Both credentials are optional, independently — pass whichever planes you
actually use:

```ts
createRaven({ token, endpoint });                       // calls only
createRaven({ chatToken, chatApiUrl });                 // messaging only
createRaven({ token, endpoint, chatToken, chatApiUrl }); // both
```

Use `raven.hasRtc` / `raven.hasChat` to branch on what's available.
Calling `join()` on an instance with no RTC credentials throws
immediately with an error explaining why, rather than failing later as a
null reference.

### Messaging on its own

```ts
import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({ token: chatTokenResp.token, apiUrl: chatTokenResp.apiUrl });
await chat.connect({ room: conversation.publicId });

chat.on('message', (message) => console.log(`${message.senderId}: ${message.text}`));
await chat.sendMessage({ text: 'Hello everyone!' });
```

Full chat API — messages, threads, presence, typing, reactions,
receipts, and attachments — lives in the [Chat](/chat) section,
since none of it is `@corvidhq/rtc`-specific.

## Browser support

`@corvidhq/rtc` feature-detects what it needs rather than maintaining a
user-agent allowlist:

```ts
import { isBrowserSupported, getBrowserSupportDetails } from '@corvidhq/rtc';

if (!isBrowserSupported()) {
  const { missing } = getBrowserSupportDetails();
  // e.g. ['RTCPeerConnection', 'navigator.mediaDevices.getUserMedia']
}
```

In practice, this means any current release of Chrome, Firefox, Safari,
or Edge. Internet Explorer and very old mobile WebViews aren't
supported (no `RTCPeerConnection`).

## Next.js

`@corvidhq/rtc` (and `@corvidhq/react`) only run in a browser — never call
`createRTCClient()` or construct anything from this package inside a
Server Component, a Route Handler, or anywhere that could execute during
server-side rendering. Always from a Client Component, typically inside
a `useEffect` or an event handler.

```tsx
// app/call/page.tsx — a Server Component is fine; it renders the client component below
import { CallClient } from './call-client';
export default function Page() {
  return <CallClient />;
}
```

```tsx
// app/call/call-client.tsx
'use client';
import { createRTCClient } from '@corvidhq/rtc';
// join inside a useEffect, never at module scope
```

If you're using `@corvidhq/react`, this is handled for you — see
[React](/sdk/react#nextjs).

## Bundle size

Measured from a real build:

| File | Raw | Gzip |
|---|---|---|
| `dist/index.js` (ESM) | 25.0 KB | 5.9 KB |
| `dist/index.cjs` (CJS) | 25.6 KB | 5.9 KB |

The underlying WebRTC client isn't bundled into these numbers — it's a
regular dependency that `npm install` pulls in automatically (nothing
extra for you to add), around 274 KB gzipped on its own.
