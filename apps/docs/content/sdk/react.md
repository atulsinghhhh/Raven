---
title: React SDK
description: Hooks and optional components on top of @corvidhq/rtc — headless by default.
---

`@corvidhq/react` is React integration on top of `@corvidhq/rtc`. Headless by
default — hooks work with any UI you build — plus a handful of
genuinely optional components for a fast start. `@corvidhq/rtc` itself
wasn't rewritten to build this; see [Web SDK](/sdk/web) for what changed
there (small, additive, non-breaking).

## Install

> **Not published to npm yet.** The commands below are what installation
> will look like once these packages are released. Until then, install
> from a local checkout — see [Installing from source](/getting-started/installing-from-source).

```bash
npm install @corvidhq/rtc @corvidhq/react
```

Peer dependency: `react` `^18 || ^19`.

## Quickstart

```tsx
'use client';
import {
  RavenRoom, useConnectionState, useLocalParticipant,
  useRemoteParticipants, useCamera, ParticipantView,
} from '@corvidhq/react';

function CallPage({ token, endpoint, roomName }) {
  return (
    <RavenRoom token={token} endpoint={endpoint} room={roomName} fallback={<p>Connecting…</p>}>
      <Call />
    </RavenRoom>
  );
}

function Call() {
  const state = useConnectionState();
  const local = useLocalParticipant();
  const remote = useRemoteParticipants();
  const camera = useCamera();

  return (
    <div>
      <p>Status: {state}</p>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
        Camera: {camera.enabled ? 'on' : 'off'}
      </button>
      {local && <ParticipantView participant={local} />}
      {remote.map((p) => <ParticipantView key={p.identity} participant={p} />)}
    </div>
  );
}
```

## Escape hatches

Three hooks exist for the cases the ergonomic ones do not cover:

```tsx
const client = useRavenClient();   // the RTCClient — devices, createCameraTrack
const raven = useRaven();          // { client, room, state } — room.on() directly
const error = useRavenError();     // the last RTCError this room emitted
const chatError = useChatError();  // the last RavenChatError, inside <RavenChat>
```

`useRavenClient()` is what you want for device enumeration, since that is a
client concern rather than a room one:

```tsx
const client = useRavenClient();
const [cameras, setCameras] = useState<DeviceInfo[]>([]);

useEffect(() => {
  if (!client) return;
  void client.getDevices('videoinput').then(setCameras);
  return client.onDeviceChange(() => void client.getDevices('videoinput').then(setCameras));
}, [client]);
```

`useRavenError()` and `useChatError()` surface the last typed error without
you registering a handler — useful for a banner. For anything that needs to
act per-error, use `onError` on the provider or `room.on('error', …)`.

## `<RavenRoom>`

The provider every hook needs, and the RTC lifecycle owner — one
`RTCClient`/`Room` for its lifetime.

```tsx
<RavenRoom
  token={token}
  endpoint={endpoint}
  room={roomName}
  iceServers={iceServers}       // optional, from the same token-mint response
  telemetryUrl={telemetryUrl}   // optional, enables telemetry
  autoConnect                    // default true — joins on mount, leaves on unmount
  fallback={<p>Connecting…</p>} // shown while connecting, or on failure
  onError={(error) => {}}       // RTCError
>
  {children}
</RavenRoom>
```

`token`/`endpoint` are read once, at mount — the same one-shot model
`@corvidhq/rtc` itself uses, since an RTC token is minted for exactly one
join. To join with a fresh token, remount with a new `key`:
`<RavenRoom key={token} token={token} .../>`.

Set `autoConnect={false}` to control the lifecycle yourself:

```tsx
function ManualJoin() {
  const { join, leave, connectionState } = useRaven();
  return (
    <>
      <button onClick={() => join('room-id')} disabled={connectionState !== 'idle'}>Join</button>
      <button onClick={() => leave()}>Leave</button>
    </>
  );
}
```

## Hooks

| Hook | Returns |
|---|---|
| `useRaven()` | The full snapshot (`connectionState`, `room`, `localParticipant`, `remoteParticipants`, `error`, `reconnectCount`) plus `join()`/`leave()`. Prefer a narrower hook below to avoid rerendering on unrelated changes. |
| `useRoom()` | The current `Room`, or `undefined` before joined. |
| `useConnectionState()` | Just the connection state string. |
| `useLocalParticipant()` / `useRemoteParticipants()` | Participant state. |
| `useCamera()` / `useMicrophone()` | `{ enabled, track?, enable(), disable(), error? }`. |

## Chat

`@corvidhq/react` gained matching hooks on top of `@corvidhq/chat` — same
pattern, same headless-by-default philosophy:

```tsx
'use client';
import { RavenChat, useMessages, useTyping } from '@corvidhq/react';

function ChatPanel({ chatToken, apiUrl, room }) {
  return (
    <RavenChat token={chatToken} apiUrl={apiUrl} room={room}>
      <Thread />
    </RavenChat>
  );
}

function Thread() {
  const { messages, send } = useMessages();
  const { onInput } = useTyping(); // call on every keystroke — throttled and auto-stopping internally

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}>{m.senderId}: {m.text}</p>
      ))}
      <input
        onChange={onInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send(e.currentTarget.value);
        }}
      />
    </div>
  );
}
```

`<RavenChat>` is the chat-side equivalent of `<RavenRoom>` — its own
provider, connecting independently, since chat and RTC never share a
connection. Use both together for a call with a chat panel, or either
alone.

| Hook | Returns |
|---|---|
| `useChat()` | The full snapshot plus `send()`, `loadMore()`, `connect()`, `disconnect()`. Prefer a narrower hook below — each reads one slice of state, so a component rendering only typing indicators doesn't re-render on every message. |
| `useMessages()` | `{ messages, send, loadMore, loading, hasMore }`. |
| `usePresence()` | `{ [userId]: status }`. |
| `useTyping()` | `{ typingUsers, onInput(), stop() }` — call `onInput()` on every keystroke; it throttles itself and stops automatically after a pause. |
| `useReactions()` | Add/remove reactions on a message. |
| `useReadReceipts()` | Read state — yours and everyone else's. |

Full API — history, threads, attachments, delivery semantics — is
`@corvidhq/chat`'s own surface underneath these hooks; see
[Chat Overview](/chat).

## Live Streaming

`<RavenLiveStream>` composes both providers above for you — a stream's
room and chat are an ordinary `Room` and `ChatClient`, so `useParticipants`,
`useCamera`, `useMessages`, `useReactions`, and every other hook already
work inside it. There is no separate `useLiveStreamParticipants()` or
`useLiveStreamChat()`; that would be the "second chat/RTC implementation"
the SDK is built specifically to avoid.

```tsx
'use client';
import {
  RavenLiveStream, useLiveStream, useLiveStreamHost, useParticipants, useMessages,
} from '@corvidhq/react';

function StreamPage({ credentials }) {
  return (
    <RavenLiveStream credentials={credentials} fallback={<p>Connecting…</p>}>
      {credentials.role === 'VIEWER' ? <Viewer /> : <Host />}
    </RavenLiveStream>
  );
}

function Host() {
  const { camera, microphone, leave } = useLiveStreamHost();
  const participants = useParticipants();
  const { messages, send } = useMessages();

  return (
    <div>
      <button onClick={() => camera.enable()}>Go live</button>
      <p>{participants.length} in the room</p>
      {messages.map((m) => <p key={m.id}>{m.senderId}: {m.text}</p>)}
      <button onClick={leave}>End for me</button>
    </div>
  );
}

function Viewer() {
  const { react } = useLiveStream();
  return <button onClick={() => react('❤️')}>❤️</button>;
}
```

`credentials` is exactly what `addHost()`/`createViewerToken()` (server
SDK) or `POST /v1/live-streams/:id/hosts`/`viewer-tokens` (REST) returns —
never construct it by hand.

| Hook | Returns |
|---|---|
| `useLiveStream()` | `{ status, role, isHost, streamId, stream, error, leave(), react(emoji) }`. |
| `useLiveStreamRole()` | `{ role, isHost }`. |
| `useLiveStreamHost()` | Everything `useLiveStream()` has, plus `camera`/`microphone` (`useCamera`/`useMicrophone` bundled in). Throws if called for a `VIEWER`-role stream. |
| `useLiveStreamViewer()` | Everything `useLiveStream()` has. Throws if called for a `HOST`/`CO_HOST`-role stream. |
| `useLiveStreamClient()` | The underlying `LiveStream` (from `@corvidhq/client`), for anything the hooks above don't cover. |

`leave()` leaves the room and disconnects chat — it does not end the
stream. Ending it (`LIVE → ENDED`) is a privileged, server-side call: see
[Live Streaming → Streams & Lifecycle](/live-streaming/streams).

Peer dependency: `@corvidhq/client` (optional — only needed if you use
`<RavenLiveStream>`).

## Next.js

Same rule as the underlying SDK: `<RavenRoom>` and every hook must run
in a Client Component. Render the provider from a `'use client'` file,
even if the page around it is a Server Component:

```tsx
// app/call/page.tsx — Server Component
import { CallClient } from './call-client';
export default function Page() {
  return <CallClient />;
}
```

```tsx
// app/call/call-client.tsx
'use client';
export function CallClient() {
  return <RavenRoom /* ... */>{/* ... */}</RavenRoom>;
}
```
