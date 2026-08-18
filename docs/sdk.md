# @raven/rtc — Browser SDK

`@raven/rtc` is Raven's browser SDK: join a room, publish camera/microphone,
subscribe to remote participants' media — without ever touching SDP, ICE
candidates, `RTCPeerConnection`, STUN, or TURN directly. Internally it wraps
`livekit-client` (Raven's chosen SFU client, see
[docs/architecture/sfu-comparison.md](architecture/sfu-comparison.md)) behind
a small, stable public API (`internal/sfu/` — see
[WebRTC abstraction](#webrtc-abstraction) below), so the public API stays the
same even if the underlying SFU integration changes later.

## Installation

```bash
npm install @raven/rtc
```

Supported browsers: **Chrome, Firefox, Safari, Edge** (current versions).
Native mobile (React Native, Flutter, iOS, Android) is explicitly out of
scope for this package — see [Browser compatibility](#browser-compatibility).

## Authentication

**Never mint an RTC token or embed a permanent API key in browser code.**
The correct architecture:

```
Developer Backend  --(API key)-->  Raven Control API
                                          |
                                          | RTC token + livekitUrl + iceServers
                                          v
                                  Developer Frontend
                                          |
                                          v
                                  Raven RTC infrastructure
```

Your backend calls `POST /v1/rooms/:roomId/rtc-tokens` (Raven's Control API,
authenticated with your project's API key) and forwards the response's
`token`, `livekitUrl`, and `iceServers` fields to the browser. The SDK never
calls the Control API itself — it only ever receives an already-minted
token.

```js
// on your frontend, having fetched `resp` from your own backend:
import { createRTCClient } from '@raven/rtc';

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.livekitUrl,
  iceServers: resp.iceServers, // never hand-construct STUN/TURN config yourself
});
```

`iceServers` is optional only so tests/advanced setups can omit it — in
normal use, always forward it from the token response. See
[docs/turn.md](turn.md) for what that array actually contains and why.

## Joining a room

```js
const room = await client.join('room-123');
```

`roomId` must match the room your token was minted for — the SDK decodes
(never verifies; the server is the source of truth) the token client-side
and throws `ROOM_NOT_FOUND` immediately if it doesn't match, rather than
letting you hit a confusing connection failure later.

Handling participants already in the room when you join:

```js
const room = await client.join('room-123');

// Already-present participants (and their already-subscribed tracks) are
// available synchronously right here — the same convention most real-time
// SDKs follow. `participantJoined`/`trackSubscribed` only fire for
// arrivals *after* this point.
for (const participant of room.remoteParticipants) {
  for (const track of participant.tracks) {
    track.attach(); // attach immediately
  }
}

room.on('participantJoined', (participant) => { /* someone new arrived */ });
```

### Leaving

```js
await room.leave();
// or, equivalently:
await client.leave(); // leaves the most recently joined room
```

Leaving stops local tracks, unsubscribes from remote tracks, closes the
underlying connection, and cleans local state — you don't need to manage
any of that yourself.

## Camera and microphone

```js
await room.enableCamera();      // captures + publishes in one call
await room.enableMicrophone();

await room.disableCamera();     // stops publishing and releases the device
await room.disableMicrophone();
```

For the "create first, publish later" pattern (e.g. a device preview before
joining a call):

```js
const track = await client.createCameraTrack();
// ... show a preview, let the user confirm ...
await room.publish(track);
```

`client.createMicrophoneTrack()` and `room.createScreenShareTrack()` work
the same way. `room.unpublish(track)` stops publishing without disabling
the whole camera/mic toggle state.

### Errors

Camera/microphone failures raise a typed `RTCError` (see [Errors](#errors)),
never a raw `DOMException`:

```js
try {
  await room.enableCamera();
} catch (error) {
  if (error.code === 'CAMERA_PERMISSION_DENIED') {
    // show your own "please allow camera access" UI
  } else if (error.code === 'DEVICE_NOT_FOUND') {
    // no camera attached
  }
}
```

## Subscribing to remote media

```js
room.on('trackSubscribed', (track, participant) => {
  videoElement.appendChild(track.attach());
  // or: someContainer.appendChild(track.attach(existingVideoElement))
});

room.on('trackUnsubscribed', (track) => {
  track.detach().forEach((el) => el.remove());
});
```

`track.attach()`/`track.attach(element)` and `track.detach()` are the only
media-element helpers the SDK provides (Phase 6 spec §20) — it is not a UI
component library.

## Participants

```js
room.localParticipant.identity;   // this session's participant identity
room.localParticipant.tracks;     // LocalTrack[] currently published

room.remoteParticipants;          // RemoteParticipant[]
participant.identity;
participant.metadata;             // opaque, set when the token was minted
participant.tracks;                // RemoteTrack[] currently subscribed
```

Per-participant connection state and live metadata updates are not exposed
in this MVP — see [Known limitations](#known-limitations).

## Track model

```
Track (base: kind, mediaStreamTrack, mediaStream, isMuted, attach(), detach())
  ├── LocalTrack  (+ mute(), unmute(), stop())
  └── RemoteTrack
```

`kind` is one of `'camera' | 'microphone' | 'screenShare' | 'unknown'`.
Data tracks are not modeled as a `Track` kind — see [Data](#data).

## Events

```js
room.on('connectionStateChanged', (state) => { ... }); // connecting|connected|reconnecting|disconnected|failed
room.on('connected', () => { ... });
room.on('disconnected', () => { ... });
room.on('reconnecting', () => { ... });
room.on('reconnected', () => { ... });

room.on('participantJoined', (participant) => { ... });
room.on('participantLeft', (participant) => { ... });

room.on('trackPublished', (kind, participant) => { ... });   // a remote participant announced a track
room.on('trackUnpublished', (kind, participant) => { ... });
room.on('trackSubscribed', (track, participant) => { ... }); // media is now actually flowing
room.on('trackUnsubscribed', (track, participant) => { ... });
room.on('trackMuted', (kind, participant) => { ... });        // Phase 11 — a remote participant muted a track they already published
room.on('trackUnmuted', (kind, participant) => { ... });

room.on('localTrackPublished', (track) => { ... });
room.on('localTrackUnpublished', (track) => { ... });

room.on('dataReceived', (payload, participant) => { ... });  // Uint8Array
room.on('error', (error) => { ... });                        // RTCError
```

Unsubscribe with `room.off(event, handler)`.

## Errors

Every error the SDK throws or emits on `room.on('error', ...)` is an
`RTCError { code, message, cause }`:

```
INVALID_TOKEN | TOKEN_EXPIRED | ROOM_NOT_FOUND | CONNECTION_FAILED
PERMISSION_DENIED | CAMERA_PERMISSION_DENIED | MICROPHONE_PERMISSION_DENIED
DEVICE_NOT_FOUND | NETWORK_ERROR | SIGNALING_ERROR | MEDIA_ERROR | TIMEOUT
```

```js
import { isRTCError } from '@raven/rtc';

try {
  await client.join('room-123');
} catch (error) {
  if (isRTCError(error)) {
    console.log(error.code, error.message);
  }
}
```

## Reconnection

The SDK surfaces livekit-client's own reconnect policy (exponential backoff
with a maximum retry delay, then a clean `failed` state — Phase 6 spec §16)
rather than reimplementing reconnect logic:

```js
createRTCClient({ token, endpoint, autoReconnect: true }); // default
```

- `autoReconnect: true` (default): automatic reconnect on network loss,
  surfaced via `reconnecting` → `reconnected` (or `disconnected` + an
  `error` with code `CONNECTION_FAILED` if retries are exhausted).
- `autoReconnect: false`: the first disconnect goes straight to
  `disconnected` — no retries.

## Device selection

```js
const devices = await client.getDevices(); // { deviceId, label, kind }[]
// kind: 'videoinput' | 'audioinput' | 'audiooutput'
// labels are populated only once permission has been granted at least once

await client.setCamera(deviceId);      // switches the active camera on the joined room
await client.setMicrophone(deviceId);  // switches the active microphone
await room.setSpeakerDevice(deviceId); // Phase 11 — switches audio output where the browser supports setSinkId (not Safari); throws DEVICE_NOT_FOUND otherwise

const unsubscribe = client.onDeviceChange(() => { /* re-enumerate — a camera/mic was connected or disconnected */ }); // Phase 11
```

## Screen sharing

```js
await room.enableScreenShare();
// or: const track = await client.createScreenShareTrack(); await room.publish(track);
```

Uses the browser's native `getDisplayMedia()` — no custom capture code.
**MVP surfaces video only**; if the browser/OS also provides a
screen-share-audio track, it is not currently exposed — see
[Known limitations](#known-limitations).

## Data

```js
await room.sendData('hello');            // string or Uint8Array
room.on('dataReceived', (payload, participant) => {
  console.log(new TextDecoder().decode(payload), participant?.identity);
});
```

Requires the token's `publishData` grant — throws `PERMISSION_DENIED`
otherwise. Kept intentionally minimal (Phase 6 spec §21): no reliability
options, no per-participant targeting exposed.

## WebRTC abstraction

The SDK encapsulates `RTCPeerConnection`, `RTCSessionDescription`,
`RTCIceCandidate`, `MediaStream`, `MediaStreamTrack`, `RTCRtpSender`, and
`RTCRtpReceiver` — you should never need to touch these directly. Structure:

```
src/
  client.ts, room.ts, track.ts, participant.ts, events.ts, errors.ts,
  logger.ts, config.ts        — public API
  internal/
    sfu/          — SFUAdapter interface + the livekit-client adapter
                    (the only file that imports livekit-client's Room)
    media/        — camera/microphone/screen-share capture + error mapping
    devices/      — device enumeration
```

`internal/sfu/types.ts`'s `SFUAdapter` interface is the boundary: `Room`
and `RTCClient` only ever talk to that interface, never to livekit-client
directly. This is also what lets the SDK's own unit tests exercise
Room/Client logic against a fake adapter, with no real browser or WebRTC
stack involved.

livekit-client itself already owns signaling, SDP, and ICE internally —
the SDK does not duplicate or reimplement that logic (Phase 6 spec §23);
it adapts livekit-client's surface to Raven's own stable public API.

## Browser compatibility

```js
import { isBrowserSupported, getBrowserSupportDetails } from '@raven/rtc';

if (!isBrowserSupported()) {
  const { missing } = getBrowserSupportDetails(); // e.g. ['RTCPeerConnection']
}
```

Feature-detected (Phase 11), not a hardcoded user-agent allowlist — see
`docs/sdk/web.md#browser-support`.

Tested (see [Files created/changed](#files) for the real two-browser-tab
test performed): **Chrome**. Firefox, Safari, and Edge were not exercised
in this environment — see [Known limitations](#known-limitations). Known
platform-specific concerns to watch for once tested (not yet confirmed
either way in this environment):

- **Safari**: stricter autoplay policy — attached `<video>`/`<audio>`
  elements may need `muted` set (for autoplay) or a user gesture before
  playback starts.
- **Autoplay restrictions** (all browsers): a remote track's element may
  need a user gesture to start playing audio.
- **Screen sharing**: `getDisplayMedia()` support and behavior (e.g. audio
  capture availability) varies by browser and OS.
- **Device enumeration**: labels are empty until permission has been
  granted at least once, consistently across browsers.
- **Mobile browsers**: not evaluated — Phase 6 targets desktop browsers
  only (native mobile SDKs are explicitly out of scope, see §4/§39).

## Bundle size

Measured from a real build (`pnpm --filter @raven/rtc build`):

| File | Raw | Gzip |
|---|---|---|
| `dist/index.js` (ESM) | 25.00 KB | 5.91 KB |
| `dist/index.cjs` (CJS) | 25.55 KB | 5.93 KB |

`livekit-client` (the wrapped SFU client) is a peer dependency, not bundled
into these numbers — it resolves separately via your own bundler/npm
install, at roughly 274 KB gzipped on its own. The SDK adds ~6 KB gzip on
top of that.

## Known limitations

- Per-participant connection state and live participant-metadata updates
  are not exposed (only identity, metadata-at-join-time, and tracks).
- Screen-share audio (when the OS/browser provides a second track) is not
  surfaced — video only.
- Data channel support is intentionally minimal — no reliability options,
  no per-participant targeting.
- Only Chrome was exercised in a real two-browser end-to-end test in this
  environment (see the real-RTC test below); Firefox/Safari/Edge are
  supported per browser API compatibility but untested here.
- Native mobile SDKs (React Native, Flutter, iOS, Android) do not exist yet
  — out of scope for this phase.
