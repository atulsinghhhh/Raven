---
title: TypeScript / Web SDK
description: Installation, browser support, and using @raven/rtc from Next.js.
---

`@raven/rtc` is Raven's browser RTC SDK — see [RTC → Overview](/rtc/overview)
for the full API (joining, tracks, events, errors, reconnection). This
page covers installation, browser support, and framework-specific usage.

## Install

> **Not published to npm yet.** The commands below are what installation
> will look like once these packages are released. Until then, install
> from a local checkout — see [Installing from source](/getting-started/installing-from-source).

```bash
npm install @raven/rtc @raven/chat
```

`@raven/rtc` and `@raven/chat` are independent packages — install only
what you use. Neither depends on the other, and either can fail without
affecting the other. For RTC, everything on this page and in
[RTC Overview](/rtc/overview) applies. For chat:

```ts
import { createChatClient } from '@raven/chat';

const chat = createChatClient({ token: chatTokenResp.token, apiUrl: chatTokenResp.apiUrl });
await chat.connect({ room: conversation.publicId });

chat.on('message', (message) => console.log(`${message.senderId}: ${message.text}`));
await chat.sendMessage({ text: 'Hello everyone!' });
```

Full chat API — messages, threads, presence, typing, reactions,
receipts, and attachments — lives in the [Chat](/chat/overview) section,
since none of it is `@raven/rtc`-specific.

## Browser support

`@raven/rtc` feature-detects what it needs rather than maintaining a
user-agent allowlist:

```ts
import { isBrowserSupported, getBrowserSupportDetails } from '@raven/rtc';

if (!isBrowserSupported()) {
  const { missing } = getBrowserSupportDetails();
  // e.g. ['RTCPeerConnection', 'navigator.mediaDevices.getUserMedia']
}
```

In practice, this means any current release of Chrome, Firefox, Safari,
or Edge — the same set LiveKit's browser client supports underneath.
Internet Explorer and very old mobile WebViews aren't supported (no
`RTCPeerConnection`).

## Next.js

`@raven/rtc` (and `@raven/react`) only run in a browser — never call
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
import { createRTCClient } from '@raven/rtc';
// join inside a useEffect, never at module scope
```

If you're using `@raven/react`, this is handled for you — see
[React](/sdk/react#nextjs).

## Bundle size

Measured from a real build:

| File | Raw | Gzip |
|---|---|---|
| `dist/index.js` (ESM) | 25.0 KB | 5.9 KB |
| `dist/index.cjs` (CJS) | 25.6 KB | 5.9 KB |

`livekit-client` (the underlying SFU client) is a peer dependency, not
bundled into these numbers — it resolves separately, around 274 KB
gzipped on its own.
