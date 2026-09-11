---
title: Handle reconnection
description: What Livqeno does automatically when a network drops, what it cannot do, and the UI you still have to build.
---

## What we're building

A call UI that behaves correctly through a network drop: it says what is
happening, it does not tear down the participant grid, and it recovers
without the user pressing anything.

## Prerequisites

- A working call — [Build a video call](/guides/build-a-video-call).

## Implementation

### 1. Render connection state, do not infer it

```ts
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';
```

<Tabs>
<Tab title="Web">

```ts
room.on('connectionStateChanged', (state) => {
  banner.textContent = {
    connecting: 'Connecting…',
    connected: '',
    reconnecting: 'Connection lost — reconnecting…',
    disconnected: 'You have left the call.',
    failed: 'Could not reconnect.',
  }[state];
});
```

</Tab>
<Tab title="React">

```tsx
import { useConnectionState } from '@ravenkash/react';

function Banner() {
  const state = useConnectionState();
  if (state === 'connected') return null;
  if (state === 'reconnecting') return <p role="status">Connection lost — reconnecting…</p>;
  if (state === 'failed') return <p role="alert">Could not reconnect.</p>;
  return <p role="status">Connecting…</p>;
}
```

</Tab>
<Tab title="Flutter">

```dart
room.connectionStateChanges.listen((state) {
  setState(() => _state = state);
});
```

</Tab>
</Tabs>

### 2. Keep the grid mounted

The mistake worth avoiding: clearing the participant list on
`reconnecting`. Livqeno does not drop participants during a reconnect, and a
grid that empties and refills makes a two-second blip look like everyone
left and rejoined.

```tsx
// Do this
{state === 'reconnecting' && <ReconnectingOverlay />}
<ParticipantGrid />              {/* stays mounted */}

// Not this
{state === 'connected' ? <ParticipantGrid /> : <Spinner />}
```

### 3. Decide what `failed` means for your product

`failed` means automatic recovery gave up. That is a product decision, not
an SDK one:

```ts
room.on('connectionStateChanged', async (state) => {
  if (state !== 'failed') return;

  // A fresh token, because the old one may have expired while offline.
  const credentials = await fetch('/join-room', { method: 'POST' }).then((r) => r.json());
  const client = createRTCClient(credentials);
  const rejoined = await client.join(credentials.roomId);
  wireUp(rejoined);
});
```

**Mint a new token.** A call that dropped for five minutes may be holding a
token that has since expired, and rejoining with it fails immediately.

On **Flutter** you can avoid this path entirely: `Raven(refreshToken: …)`
hands the signaling client a fresh token before each reconnect attempt. The
web and React Native SDKs do not expose that hook, so mint-and-rejoin is
the route there. See
[Known limitations](/reference/known-limitations).

### 4. Wait for a connection when you need one

```ts
const room = await client.join(roomId);
await room.waitUntilConnected(15_000);   // resolves on connect, rejects on timeout
await room.enableCamera();
```

Useful when the next step genuinely requires a live connection rather than
a joined room object.

### 5. Show quality before it becomes a drop

```ts
setInterval(async () => {
  const stats = await room.getConnectionStats();
  const worst = Math.max(0, ...stats.remote.map((t) => t.packetLossPercent ?? 0));
  setQuality(worst > 10 ? 'poor' : worst > 3 ? 'fair' : 'good');
}, 5000);
```

`stats.connectionQuality` is the media server's own verdict, and today it
usually reports `'unknown'` — the server does not compute a quality figure
yet, and the SDK reports that honestly rather than substituting a
client-side guess. The per-track numbers above are real measurements, so
drive your indicator from those.

## How it works

**Reconnection is automatic and on by default.** `autoReconnect: true`. The
SDK re-establishes signaling with exponential backoff and resets the peer
connection, then republishes what you had published.

**Your tracks survive.** You do not re-enable the camera after a
reconnect. That is why `reconnected` carries no payload — nothing for you
to reattach.

**The states come from the transport, not from a guess.** `reconnecting`
means the socket actually dropped. Separately, `connection.state` frames
carry the media server's own view of ICE and DTLS, which is why
`getDiagnostics()` can show you "server says failed, browser says
connected" — a diagnosis, not a contradiction.

**A token expiring mid-call does not drop the call.** The token is checked
at join. An expired token only bites when something tries to connect again,
which is exactly the `failed` path above.

## Production considerations

- **TURN is what makes reconnection work on real networks.** A client that
  changes network — Wi-Fi to cellular — usually needs a relay. If TURN is
  misconfigured, reconnects fail in ways that look random. See
  [TURN & NAT traversal](/self-hosting/turn).
- **`iceServers` must come from a fresh mint.** TURN credentials expire
  with the token. Reusing an old `iceServers` array on a rejoin is a common
  and confusing failure.
- **Server deploys close sockets deliberately.** A rolling update closes
  connections with a distinct code and clients reconnect elsewhere. Your
  `reconnecting` UI is what a deploy looks like to a user.
- **Test it properly.** Turn Wi-Fi off for ten seconds; do not just reload.
  Chrome DevTools' offline toggle does not exercise the same path.

## Next steps

- [Reconnection & network quality](/rtc/reconnection) — the per-SDK reference.
- [Diagnostics](/rtc/diagnostics) · [Troubleshooting](/rtc/troubleshooting)
