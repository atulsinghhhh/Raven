---
title: TypeScript / Web SDK
description: Installing @ravenkash/rtc, @ravenkash/chat, and @ravenkash/client; browser support; and using them from Next.js.
---

Raven ships three browser packages: `@ravenkash/rtc` for calls,
`@ravenkash/chat` for messaging, and `@ravenkash/client` for both behind one
object. This page covers which to install, browser support, and
framework-specific usage — the full APIs live in
[RTC → Overview](/rtc) and [Chat → Overview](/chat).

## Install

Pick the package that matches what you're building:

| You want | Install | Import |
|---|---|---|
| Calls only | `@ravenkash/rtc` | `createRTCClient` |
| Messaging only | `@ravenkash/chat` | `createChatClient` |
| Both | `@ravenkash/client` | `createRaven` |

```bash
npm install @ravenkash/rtc          # calls
npm install @ravenkash/chat         # messaging
npm install @ravenkash/client       # both, behind one object
```

`@ravenkash/rtc` and `@ravenkash/chat` are independent packages — neither
depends on the other, and either can fail without affecting the other.
Install only what you use; `@ravenkash/rtc` alone is ~10.2 KB gzipped and
pulls in no messaging code.

### Calls and messaging together — `@ravenkash/client`

If your app does both, `@ravenkash/client` wires the two clients from one
config so you aren't managing two objects and two token lifecycles:

```ts
import { createRaven } from '@ravenkash/client';

// Every value here comes from your backend's token-mint response.
// Never mint a token in the browser.
const raven = createRaven({
  token: rtc.token,           // POST /v1/rooms/{roomId}/rtc-tokens
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
[`@ravenkash/react-native`](/sdk/react-native) already gives mobile, so the
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
import { createChatClient } from '@ravenkash/chat';

const chat = createChatClient({ token: chatTokenResp.token, apiUrl: chatTokenResp.apiUrl });
await chat.connect({ room: conversation.publicId });

chat.on('message', (message) => console.log(`${message.senderId}: ${message.text}`));
await chat.sendMessage({ text: 'Hello everyone!' });
```

Full chat API — messages, threads, presence, typing, reactions,
receipts, and attachments — lives in the [Chat](/chat) section,
since none of it is `@ravenkash/rtc`-specific.

## Browser support

`@ravenkash/rtc` feature-detects what it needs rather than maintaining a
user-agent allowlist:

```ts
import { isBrowserSupported, getBrowserSupportDetails } from '@ravenkash/rtc';

if (!isBrowserSupported()) {
  const { missing } = getBrowserSupportDetails();
  // e.g. ['RTCPeerConnection', 'navigator.mediaDevices.getUserMedia']
}
```

In practice, this means any current release of Chrome, Firefox, Safari,
or Edge. Internet Explorer and very old mobile WebViews aren't
supported (no `RTCPeerConnection`).

## Next.js

`@ravenkash/rtc` (and `@ravenkash/react`) only run in a browser — never call
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
import { createRTCClient } from '@ravenkash/rtc';
// join inside a useEffect, never at module scope
```

If you're using `@ravenkash/react`, this is handled for you — see
[React](/sdk/react#nextjs).

## Bundle size

Measured from a real build:

| File | Raw | Gzip |
|---|---|---|
| `dist/index.js` (ESM) | 40.1 KB | 10.2 KB |
| `dist/index.cjs` (CJS) | 40.7 KB | 10.2 KB |

The underlying WebRTC client isn't bundled into these numbers — it's a
regular dependency that `npm install` pulls in automatically (nothing
extra for you to add), around 274 KB gzipped on its own.
