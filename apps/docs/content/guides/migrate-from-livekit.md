---
title: Migrate from LiveKit
description: A concept-by-concept mapping, the places the two differ in kind, and what has no equivalent.
---

## What we're building

A translation. If you have a LiveKit integration, this is what changes and
what does not.

Raven's media plane was itself migrated off LiveKit, so this mapping comes
from having done it rather than from reading a comparison table.

## Prerequisites

- An existing LiveKit integration.
- A Raven project and API key.

## Implementation

### The concepts map closely

| LiveKit | Raven | Notes |
|---|---|---|
| Room | [Room](/concepts/room) | Same idea. Raven's is a control-plane record; a server is allocated on first join. |
| Participant | [Participant](/concepts/participant) | Identity is a string your backend chooses, signed into the token. |
| Track | [Track](/concepts/track) | Raven declares the *source* — `camera`, `microphone`, `screenShare`. |
| Access token | [Token](/concepts/token) | Minted server-side. Max 6 hours; no non-expiring option. |
| API key / secret | [API key](/concepts/api-key) | One `rvk_<env>_id.secret` string rather than a key/secret pair. |
| Server SDK | `@corvidhq/server`, `raven-sdk` | Same job. |
| Egress / Ingress | — | **No equivalent.** Raven has no recording and no RTMP ingest. |
| Webhooks | [Webhooks](/webhooks) | Raven's fire for chat and live-stream events, not RTC lifecycle. |

### Token minting

```ts
// Raven
const credentials = await raven.tokens.create({
  room: room.id,                 // the room's id, not its name
  identity: 'user-42',
  permissions: { join: true, subscribe: true, publish: true },
  expiresIn: 600,
});
```

Two differences that matter:

- **Permissions are denied unless granted.** LiveKit's unset
  `canPublish`/`canSubscribe` meant *both granted*. Raven resolves every
  flag to an explicit boolean at mint time, so there is no permissive
  default to inherit.
- **You forward the whole response.** `endpoint`, `iceServers` and
  `telemetryUrl` come back with the token and the client needs all of them.
  There is no separately-configured server URL, and you never build an
  `iceServers` array yourself.

### Client connection

```ts
import { createRTCClient } from '@corvidhq/rtc';

const client = createRTCClient(credentials);
const room = await client.join(credentials.roomId);

await room.enableCamera();
await room.enableMicrophone();
```

`enableCamera()`/`enableMicrophone()` replace the create-then-publish
dance for the common case. The explicit form is still there when you need
it:

```ts
const track = await client.createCameraTrack(deviceId);
await room.publish(track);
```

### Events

Raven's event names are its own. The mapping is mostly mechanical —
`participantJoined`, `participantLeft`, `trackSubscribed`,
`trackUnsubscribed`, `trackMuted`, `connectionStateChanged` — and the full
list is in [RTC events](/rtc/events).

No WebRTC type is ever exposed. There is no `RTCPeerConnection`,
`RTCRtpSender` or `MediaStreamTrack` in Raven's public API except
`track.mediaStreamTrack` when you deliberately reach for it.

## How it works

**A client has exactly one peer: the media server serving its room.** Same
SFU topology, so your mental model transfers.

**Clients never learn which media server they got.** They connect to a
signaling endpoint and Raven allocates on their behalf. That indirection is
what let Raven replace its own media plane without an SDK release — and it
means there is no server address for you to configure.

**The signaling protocol is not LiveKit's.** If you wrote anything against
the wire protocol rather than the SDK, that work does not carry over. See
[Signaling protocol](/rtc/signaling-protocol).

## Production considerations

- **Nothing recording-shaped will port.** No Egress, no Ingress, no
  composite output, no RTMP. If your product depends on any of it, Raven
  cannot replace LiveKit for that part today.
- **Re-audit your permissions.** Code that relied on "unset means allowed"
  will produce participants who cannot publish. That is the intended
  direction of the change, but it will surface as a bug during migration.
- **Verify on your own networks.** Raven's relay path is tested and its
  browser coverage is Chromium-only so far. See
  [Known limitations](/reference/known-limitations).

## Next steps

- [Concepts](/concepts) — the vocabulary in full.
- [RTC quickstart](/rtc/quickstart) · [Signaling protocol](/rtc/signaling-protocol)
