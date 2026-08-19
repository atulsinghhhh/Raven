---
title: RTC Quickstart
description: Install, authenticate, join a room, and publish media — the shortest real path to a working call, on every supported SDK.
---

What you'll build: two participants in a room, each publishing camera
and microphone and seeing/hearing the other. Every step below is the
real API — copy it, swap in your own token endpoint, and it runs.

**Prerequisites:** a Raven project and a project API key (see
[API Keys](/authentication)) — RTC tokens are minted with it, server-side,
and never in a browser or app.

## 1. Install

<Tabs>
<Tab title="Web">

```bash
npm install @corvidhq/rtc
```

</Tab>
<Tab title="React">

```bash
npm install @corvidhq/rtc @corvidhq/react
```

</Tab>
<Tab title="React Native">

```bash
npm install @corvidhq/react-native @corvidhq/rtc \
            @livekit/react-native @livekit/react-native-webrtc

cd ios && pod install   # iOS only
```

The two `@livekit/*` packages are required native modules — React
Native's autolinking needs them installed directly in your app. You
never import or call them yourself; see [Permissions](/rtc/permissions)
for the OS-level setup they also require.

</Tab>
<Tab title="Flutter">

```yaml
dependencies:
  raven_rtc:
    path: ../path/to/your-checkout/sdks/flutter/raven_rtc
```

Not on pub.dev yet — see
[Installing from source](/getting-started/installing-from-source).

</Tab>
</Tabs>

## 2. Authenticate

Mint a token on your backend — never construct one client-side:

<Tabs>
<Tab title="Node.js">

```ts
import { Raven } from '@corvidhq/server';
const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

app.post('/join-room', async (req, res) => {
  const room = await raven.rooms.create({ name: 'demo-room' });
  const token = await raven.tokens.create({
    room: room.id,
    identity: req.user.id,
    permissions: { join: true, publish: true, subscribe: true },
  });
  res.json(token); // { token, endpoint, iceServers, ... }
});
```

</Tab>
<Tab title="Python">

```python
from raven import Raven, CreateTokenParams, TokenPermissions

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])

@app.post("/join-room")
def join_room(request):
    room = raven.rooms.create(name="demo-room")
    token = raven.tokens.create(
        CreateTokenParams(
            room=room["id"],
            identity=request.user.id,
            permissions=TokenPermissions(join=True, publish=True, subscribe=True),
        )
    )
    return token  # {"token": ..., "endpoint": ..., "iceServers": [...], ...}
```

</Tab>
</Tabs>

See [Authentication](/rtc/authentication) for what each permission
controls.

## 3. Create a client and join

<Tabs>
<Tab title="Web">

```ts
import { createRTCClient } from '@corvidhq/rtc';

const resp = await fetch('/join-room', { method: 'POST' }).then((r) => r.json());

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.endpoint,
  iceServers: resp.iceServers,
});

const room = await client.join('demo-room');
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { RavenRoom, useConnectionState } from '@corvidhq/react';

function CallPage({ token, endpoint, iceServers }) {
  return (
    <RavenRoom token={token} endpoint={endpoint} iceServers={iceServers} room="demo-room" fallback={<p>Connecting…</p>}>
      <Call />
    </RavenRoom>
  );
}

function Call() {
  const state = useConnectionState(); // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'
  return <p>Status: {state}</p>;
}
```

`<RavenRoom>` joins on mount and leaves on unmount — there's no
separate `join()`/`client.join()` call to make yourself.

</Tab>
<Tab title="React Native">

```ts
import { Raven } from '@corvidhq/react-native';

const raven = new Raven({ token: resp.token, endpoint: resp.endpoint, iceServers: resp.iceServers });
const room = await raven.join('demo-room');
```

`new Raven(...)` registers the WebRTC globals for you — see
[Troubleshooting](/rtc/troubleshooting) if you ever need to do that
earlier, before a `Raven` instance exists.

</Tab>
<Tab title="Flutter">

```dart
import 'package:raven_rtc/raven_rtc.dart';

final raven = Raven(token: resp.token, endpoint: resp.endpoint, iceServers: resp.iceServers);
final room = await raven.join('demo-room');
```

</Tab>
</Tabs>

## 4. Enable microphone and camera

<Tabs>
<Tab title="Web">

```ts
await room.enableCamera();      // captures and publishes in one call
await room.enableMicrophone();
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useCamera, useMicrophone } from '@corvidhq/react';

function Controls() {
  const camera = useCamera();
  const microphone = useMicrophone();
  return (
    <>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
        Camera: {camera.enabled ? 'on' : 'off'}
      </button>
      <button onClick={() => (microphone.enabled ? microphone.disable() : microphone.enable())}>
        Mic: {microphone.enabled ? 'on' : 'off'}
      </button>
    </>
  );
}
```

</Tab>
<Tab title="React Native">

```ts
await room.enableCamera();
await room.enableMicrophone();
```

The same `Room` class as web — `raven.join()` returned it. Camera and
microphone permission is requested automatically the first time
`raven.join()` runs; see [Permissions](/rtc/permissions).

</Tab>
<Tab title="Flutter">

```dart
await room.enableCamera();
await room.enableMicrophone();
```

</Tab>
</Tabs>

Publishing happens automatically once a device is enabled — there's no
separate `publish()` call to remember, on any platform.

## 5. Receive a participant

Anyone already in the room arrives synchronously; anyone who joins after
you fires an event.

<Tabs>
<Tab title="Web">

```ts
for (const participant of room.remoteParticipants) {
  for (const track of participant.tracks) {
    videoElement.appendChild(track.attach());
  }
}

room.on('trackSubscribed', (track, participant) => {
  videoElement.appendChild(track.attach());
});
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { useRemoteParticipants, ParticipantView } from '@corvidhq/react';

function RemoteGrid() {
  const remote = useRemoteParticipants();
  return remote.map((p) => <ParticipantView key={p.identity} participant={p} />);
}
```

`useRemoteParticipants()` already re-renders on `trackSubscribed` —
there's no event listener to wire up yourself.

</Tab>
<Tab title="React Native">

```tsx
import { useRemoteParticipants, RavenVideoView } from '@corvidhq/react-native';

function RemoteGrid({ room }) {
  const remote = useRemoteParticipants(room);
  return remote.map((p) => <RavenVideoView key={p.identity} participant={p} room={room} style={{ flex: 1 }} />);
}
```

</Tab>
<Tab title="Flutter">

```dart
for (final participant in room.remoteParticipants) {
  // build a RavenVideoView(participant: participant, room: room) per participant
}

room.participantChanges.listen((participants) {
  // rebuild your grid — participants is the full current roster
});
```

</Tab>
</Tabs>

## 6. Leave

<Tabs>
<Tab title="Web">

```ts
await room.leave();
```

</Tab>
<Tab title="React">

Unmount `<RavenRoom>` — it calls `leave()` for you. To leave without
unmounting (e.g. a "Leave call" button that stays on the page), use
`useRaven()`:

```tsx
const { leave } = useRaven();
<button onClick={() => leave()}>Leave</button>
```

</Tab>
<Tab title="React Native">

```ts
await raven.leave();   // leaves the room, keeps any chat connection open
await raven.dispose(); // tears down everything, including chat
```

</Tab>
<Tab title="Flutter">

```dart
await raven.leave();
```

</Tab>
</Tabs>

## What Raven handles vs. what you handle

**Raven handles:** signaling, media routing through the SFU, ICE/TURN
negotiation, reconnection with backoff, and firing participant/track
events as the room's state actually changes.

**You handle:** minting tokens from your own authenticated backend
session, the UI around connection/error states, and requesting device
permission (automatic on React Native/Flutter, browser-native on web).

## Common errors

| Error | Why | Fix |
|---|---|---|
| `ROOM_NOT_FOUND` | `roomId` passed to `join()` doesn't match what the token was minted for. | Pass the same room id/name your backend used in `tokens.create({ room })`. |
| `TOKEN_EXPIRED` | Tokens are short-lived by default. | Mint a fresh one — there's no way to extend an existing token's lifetime. |
| `CAMERA_PERMISSION_DENIED` / `MICROPHONE_PERMISSION_DENIED` | OS or browser denied device access. | See [Permissions](/rtc/permissions). |

See [Troubleshooting](/rtc/troubleshooting) for connection failures that
aren't a thrown error (e.g. "works on Wi-Fi, fails on cellular").

## Production notes

- Never call `raven.tokens.create()` (or any `@corvidhq/server`/`raven-sdk`
  method) from a browser or app — it needs your project API key, which
  must never leave your backend.
- Derive `identity` from your own authenticated session, never from a
  value the client sent — anyone could ask to join as anyone else.
- Forward `iceServers` from the token response as-is. Hand-constructing
  your own is the most common cause of calls that work on Wi-Fi but fail
  on cellular or a corporate network.

## Related

- [RTC → Overview](/rtc) — the room/participant/track model behind this.
- [Rooms & Participants](/rtc/rooms-and-participants) — device selection, data messages.
- [Audio & Video](/rtc/audio-and-video) — the create-then-publish pattern, muting.
- Need messaging alongside the call? See [Chat](/chat) — the two planes are independent.

## API reference

`createRTCClient` / `Raven` / `RavenRoom`, `Room`, `Participant`, `Track`
— full method and event tables in [RTC → Overview](/rtc#events).
