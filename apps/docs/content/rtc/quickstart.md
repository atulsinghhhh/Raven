---
title: RTC Quickstart
description: Install, authenticate, join a room, and publish media — the shortest real path to a working call.
---

## 1. Install

```bash
npm install @raven/rtc
```

## 2. Authenticate

Mint a token on your backend — never construct one client-side:

```ts
// your backend
import { Raven } from '@raven/server';
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

See [Authentication](/rtc/authentication) for what each permission controls.

## 3. Create a client and join

```ts
import { createRTCClient } from '@raven/rtc';

const resp = await fetch('/join-room', { method: 'POST' }).then((r) => r.json());

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.endpoint,
  iceServers: resp.iceServers,
});

const room = await client.join('demo-room');
```

## 4. Enable microphone/camera and publish

```ts
await room.enableCamera();
await room.enableMicrophone();
```

Publishing happens automatically once a device is enabled — there's no
separate `publish()` call to remember.

## 5. Receive a participant

Anyone already in the room arrives synchronously; anyone who joins after
you fires `trackSubscribed`:

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

## 6. Leave

```ts
await room.leave();
```

That's a full call. For the room/participant/track model behind it, see
[RTC → Overview](/rtc). Need messaging alongside the call? See
[Raven Chat](/chat) — video plus a chat panel is a very common pairing,
and the two planes are entirely independent.
