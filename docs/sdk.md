# @corvidhq/rtc — Browser SDK

`@corvidhq/rtc` is Raven's browser SDK: join a room, publish camera/microphone,
subscribe to remote participants' media — without ever touching SDP, ICE
candidates, `RTCPeerConnection`, STUN, or TURN directly. Internally it
speaks Raven's own signaling protocol over a native `RTCPeerConnection`,
behind a small, stable `SFUAdapter` boundary (`internal/sfu/` — see
[WebRTC abstraction](#webrtc-abstraction) below).

That boundary has already earned its keep: Raven's media plane was
replaced wholesale — a third-party SFU for Raven's own, on Pion — and
because `Room` and `RTCClient` only ever talked to `SFUAdapter`, the
public API below did not change. See
[the migration guide](migration/from-livekit.md) if you are upgrading.

## Installation

```bash
npm install @corvidhq/rtc
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
                                          | RTC token + endpoint + iceServers
                                          v
                                  Developer Frontend
                                          |
                                          v
                                  Raven RTC infrastructure
```

Your backend calls `POST /v1/rooms/:roomId/rtc-tokens` (Raven's Control API,
authenticated with your project's API key) and forwards the response's
`token`, `endpoint`, and `iceServers` fields to the browser. The SDK never
calls the Control API itself — it only ever receives an already-minted
token.

`endpoint` is Raven's own signaling WebSocket (`wss://your-api/v1/rtc`).
It is deliberately a Raven-owned address rather than a media server's: a
client that learned an SFU's address could connect to it directly, and
then the media plane could not change without breaking that client.

```js
// on your frontend, having fetched `resp` from your own backend:
import { createRTCClient } from '@corvidhq/rtc';

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.endpoint,
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
import { isRTCError } from '@corvidhq/rtc';

try {
  await client.join('room-123');
} catch (error) {
  if (isRTCError(error)) {
    console.log(error.code, error.message);
  }
}
```

## Reconnection

Reconnect is the SDK's own: exponential backoff with jitter and a maximum
retry delay, then a clean `failed` state (Phase 6 spec §16). There is no
session resumption — a reconnect rejoins from scratch and rebuilds from
the `room.joined` and offer that follow, because the server allocates a
fresh media session rather than reviving the old one:

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
    sfu/          — SFUAdapter interface + RavenAdapter, the only place
                    an RTCPeerConnection is touched
    signaling/    — the wire protocol and its WebSocket client
    media/        — camera/microphone/screen-share capture + error mapping
    devices/      — device enumeration
    telemetry/    — best-effort stats reporting, never on the media path
```

`internal/sfu/types.ts`'s `SFUAdapter` interface is the boundary: `Room`
and `RTCClient` only ever talk to that interface, never to a peer
connection directly. That is what lets the SDK's own unit tests exercise
Room/Client logic against a fake adapter with no browser involved — and
it is what made replacing the entire media plane a one-line change to a
default factory.

What the SDK does **not** implement is the transport: ICE, DTLS, SRTP and
SCTP all come from the browser's own WebRTC stack (Phase 6 spec §23, and
spec §9's "use standards-compliant WebRTC"). What it implements is the
layer above — the signaling protocol, negotiation ordering, track
attribution, and the `Room` model a developer actually uses.

## Browser compatibility

```js
import { isBrowserSupported, getBrowserSupportDetails } from '@corvidhq/rtc';

if (!isBrowserSupported()) {
  const { missing } = getBrowserSupportDetails(); // e.g. ['RTCPeerConnection']
}
```

Feature-detected (Phase 11), not a hardcoded user-agent allowlist — see
`docs/sdk/web.md#browser-support`.

Tested: **Chrome**, two browser tabs against a live stack. Firefox, Safari, and Edge were not exercised
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

Measured from a real build (`pnpm --filter @corvidhq/rtc build`):

| File | Raw | Gzip |
|---|---|---|
| `dist/index.js` (ESM) | 80.57 KB | 21.09 KB |
| `dist/index.cjs` (CJS) | 80.87 KB | 21.13 KB |

**That is the whole cost.** There is no peer media-plane SDK resolving
alongside it: WebRTC comes from the browser. The SDK grew from ~6 KB to
~21 KB gzipped when it took over signaling, negotiation and track
attribution from a third-party client — which is a ~15 KB increase in
Raven's own code in exchange for dropping a ~274 KB gzipped dependency.

Re-measure rather than trusting this table:
`pnpm --filter @corvidhq/rtc build && node packages/sdk/scripts/print-bundle-size.mjs`.

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
