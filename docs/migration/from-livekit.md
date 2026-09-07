# Migrating from Raven + LiveKit

Raven used to run its media plane on LiveKit. It now runs its own: Raven's
signaling protocol, Raven's SFU, standards-compliant WebRTC.

```text
Before                          After

Application                     Application
    │                               │
Raven SDK                       Raven SDK
    │                               │
livekit-client                  Raven Signaling  (WebSocket)
    │                               │
LiveKit Server                  Raven SFU        (Go/Pion)
    │                               │
WebRTC                          WebRTC
                                (ICE/DTLS/SRTP/RTP/RTCP)
```

**LiveKit references in this document are intentional.** It is the
migration guide; describing what changed requires naming what it changed
from. Nothing here describes a runtime dependency — see
[the removal checklist](#verifying-livekit-is-gone).

---

## The short version

If you use the Raven SDKs and did not hand-configure anything, **your
application code does not change.** Update the SDK, update your
deployment's environment variables, run an SFU. That is the whole
migration for most callers.

```ts
// Unchanged. This is the same code before and after.
const client = createRTCClient({ token, endpoint, iceServers });
const room = await client.join('room_123');

await room.enableMicrophone();
await room.enableCamera();
```

That held because the SDK already had an `SFUAdapter` boundary that
`Room` and `RTCClient` were written against, and neither ever imported
`livekit-client`. Replacing the implementation behind it was a one-line
change to a default.

---

## What you must change

### 1. Environment variables

| Removed | Replaced by | Notes |
|---|---|---|
| `LIVEKIT_URL` | *(nothing)* | Clients now connect to Raven's own signaling. `endpoint` in the token-mint response is derived from `API_PUBLIC_URL`; override with `RTC_SIGNALING_URL` only if signaling is fronted on a separate hostname. |
| `LIVEKIT_API_KEY` | *(nothing)* | Raven's tokens are Raven's own. There is no second party to authenticate to. |
| `LIVEKIT_API_SECRET` | `RTC_TOKEN_SECRET` | Not a rename — a different key for a different token format. Generate a fresh one. |
| `LIVEKIT_INTERNAL_URL` | *(nothing)* | The control plane finds RTC servers through the registry; there is no address to configure. |
| — | `SFU_REGISTRATION_SECRET` | **New, required in production.** How an SFU authenticates to the control plane. Must differ from `RTC_TOKEN_SECRET`. |
| — | `SFU_DEFAULT_REGION` | Region used when a join requests none. Defaults to `local`. |
| — | `SFU_HEARTBEAT_TIMEOUT_SECONDS` | How long before a silent node stops receiving new rooms. Defaults to 30. |

Production boot **fails** if `RTC_TOKEN_SECRET` or
`SFU_REGISTRATION_SECRET` is missing, or if either duplicates
`JWT_SECRET`, `CHAT_TOKEN_SECRET`, or each other. That is deliberate: a
deployment where one leaked credential mints all of them is worse than a
deployment that refuses to start. See [security](../rtc/security.md).

```bash
openssl rand -hex 32   # RTC_TOKEN_SECRET
openssl rand -hex 32   # SFU_REGISTRATION_SECRET
```

### 2. Run an SFU

LiveKit was one container. Raven's SFU is one container too, but it needs
a **published UDP range** for media, because media does not go through
your API's ingress — ICE hands clients a host and port and they connect
to it directly.

```yaml
sfu:
  image: raven/sfu:dev            # or build ./services/sfu
  environment:
    SFU_NODE_ID: sfu-local-01
    SFU_REGION: local
    SFU_PUBLIC_IP: 203.0.113.10   # what ICE advertises — not the container's private IP
    SFU_CONTROL_PLANE_URL: http://api:4000
    SFU_REGISTRATION_SECRET: ${SFU_REGISTRATION_SECRET}
    SFU_UDP_PORT_MIN: 51000
    SFU_UDP_PORT_MAX: 51200
  ports:
    - "7000:7000"                       # control: node link, health, metrics
    - "51000-51200:51000-51200/udp"     # media — published 1:1, never remapped
```

The UDP range must be published **one-to-one**. ICE advertises the exact
port it bound, so a remapped range hands clients addresses that do not
exist. See [networking](../rtc/networking.md).

Nothing provisions the node in the control plane. It registers itself on
boot and heartbeats; `raven rtc servers list` shows the fleet.

### 3. Mobile: swap the native dependency

**React Native** — replace two packages with one:

```diff
- "@livekit/react-native": "^2.12.0",
- "@livekit/react-native-webrtc": "^144.1.2",
+ "react-native-webrtc": "^124.0.8",
+ "react-native-incall-manager": "^4.2.2",
```

`react-native-incall-manager` is optional and only needed for call-audio
routing. `pod install` again after installing.

**Flutter** — replace `livekit_client`:

```diff
- livekit_client: ^2.11.0
+ flutter_webrtc: ^1.6.0
+ web_socket_channel: ^3.0.0
```

Both mobile SDKs keep the same public API. `Raven`, `RavenRoom`,
`room.enableCamera()`, `RavenVideoView`, `RavenPermissions` all behave as
before.

---

## Behaviour that changed

Six things a careful caller may notice. Everything else is unchanged.

### `join()` resolves before media is connected

The one change that can affect working code. LiveKit's `connect()`
resolved only once the media connection was established, so
`await client.join(...)` returning meant `connectionState` was
already `'connected'`. Raven's resolves when the **control plane** has
admitted you: the room is joined, you know who else is in it, and you can
publish — but ICE and DTLS complete a moment later.

```ts
const room = await client.join('room_123');
room.connectionState;         // 'connecting' — not yet 'connected'

await room.enableCamera();    // works anyway; publishing does not wait
```

**Nothing in the documented usage breaks**, because `enableCamera()` and
`enableMicrophone()` work during that window and the `connected` event is
what a UI should render from. What breaks is code that *asserts* on
`connectionState` on the line after `join()`.

Two ways to fix it, in order of preference:

```ts
// 1. Drive the UI from the event. Correct for a reconnect too, which no
//    amount of awaiting a join can cover.
room.on('connected', () => setStatus('live'));

// 2. Block, when you genuinely must — a test, or a flow that cannot
//    proceed until media is up.
await room.waitUntilConnected();   // additive; throws on failure or timeout
```

This is not a regression being papered over: an SFU connection genuinely
has two stages, and `join()` resolving early is what lets a client
render the room and start capturing while ICE is still gathering. But a
subscriber joining a room where nobody is publishing may sit in
`'connecting'` indefinitely and correctly — there is nothing to
negotiate — which is why `waitUntilConnected()` takes a timeout and why
the event is the better default.

### `endpoint` now points at Raven, not at a media server

The token-mint response's `endpoint` was LiveKit's `wss://` URL; it is now
Raven's signaling WebSocket (`wss://your-api/v1/rtc`). If you forwarded it
to the SDK as documented, nothing changes. If you hard-coded a LiveKit URL
anywhere, remove it.

Clients are never told which SFU serves their room — only its *name*, for
support. That is what allows the media plane to be re-shaped without an
SDK release.

### RTC tokens are a different format

Same shape in the response, different claims inside. If you were
inspecting the token's payload yourself, the claim names changed:

| LiveKit claim | Raven claim |
|---|---|
| `video.room` | `rnm` (room name), `rid` (room id) |
| `sub` | `sub` (unchanged) |
| `video.canPublish` etc. | `perms.publish` etc. |
| `attributes.ravenProjectId` | `pid` |
| `attributes.ravenEnvironment` | `env` |

The token also now carries `aud: "raven-rtc"`, so a chat token or a
dashboard session JWT can never be replayed as an RTC token.

You should not need any of this: the server verifies the token, and the
SDK reads only the room id from it.

### `getConnectionQuality()` returns `'unknown'`

LiveKit computed a server-side quality verdict from a vantage point a
client cannot have — it sees loss and jitter on every leg of a room.
Raven's SFU does not compute an equivalent yet.

Rather than return a client-side guess dressed up as a server verdict, it
returns `'unknown'`. **This is a real regression, and it is temporary.**
What replaced it in the meantime is better in one respect: `getConnectionStats()`
returns real, measured per-track numbers.

```ts
const stats = await room.getConnectionStats();
// stats.local / stats.remote: bitrate, packet loss, jitter, RTT, codec, fps
```

If your UI showed a quality badge from `getConnectionQuality()`, derive it
from `getConnectionStats()` for now, or hide it. Do not treat `'unknown'`
as "good".

### `getDiagnostics()` gained real fields

These were always `undefined` under LiveKit, which did not expose them:

```ts
const diagnostics = room.getDiagnostics();
diagnostics.iceConnectionState;        // now populated
diagnostics.signalingState;            // now populated
diagnostics.remoteIceConnectionState;  // new — what the SFU thinks
diagnostics.remotePeerConnectionState; // new
```

The last two are worth attaching to bug reports. The two sides of a
connection can disagree, and "the server says failed while the browser
says connected" is a diagnosis rather than a contradiction.

### Two new error codes and one new method

Additive — no existing code changed meaning.

- **`Room.waitUntilConnected(timeoutMs?)`** — see the join-timing section
  above.
- **`NOT_SUPPORTED`** (`@corvidhq/rtc`) — the platform cannot do this at
  all, e.g. screen sharing on a mobile browser with no `getDisplayMedia`.
  A permanent fact a UI should reflect by hiding the button, unlike
  `MEDIA_ERROR`, which is worth retrying.
- **`RAVEN_NO_RTC_CAPACITY`** (HTTP API) — no healthy RTC server had room.
  An operator problem, not a caller one.

### Flutter: `dynacast` is currently a no-op

`Raven(dynacast: true)` still compiles and is still accepted. Dynacast
means the *server* stops relaying simulcast layers nobody subscribes to;
Raven's SFU does not implement that yet, so today it changes nothing.

It is kept in the constructor rather than removed so existing code
compiles unchanged, and it will start having an effect when the SFU gains
the capability. `adaptiveStream` **does** work — implemented by
requesting a simulcast layer per view size.

---

## The signaling protocol changed shape

Only relevant if you wrote a client against Raven's WebSocket directly
rather than using an SDK.

The old protocol was a **full mesh relay**: every SDP and ICE message
named a `targetParticipantId`, and the server forwarded it between
browsers. That shape cannot express an SFU — a client has exactly one
peer, the node serving its room.

```diff
- { "type": "sdp.offer", "targetParticipantId": "bob", "sdp": "..." }
+ { "type": "sdp.answer", "sdp": "..." }
```

Message names largely survived; their meaning did not. `sdp.offer` from
the server is now the SFU's own offer, which you answer. New messages:
`track.publish` (declare a track's source), `track.muted` / `track.unmuted`,
`subscription.update` (request a simulcast layer), `connection.state`.

See [signaling](../rtc/signaling.md) for the full contract.

---

## Verifying LiveKit is gone

```bash
# No declared dependency.
grep -rn --include=package.json --include=pubspec.yaml \
  '"\(livekit[a-z-]*\|@livekit/[a-z-]*\)"[[:space:]]*:' . | grep -v node_modules

# No resolved dependency — a stale lockfile is a real dependency.
grep -rln livekit --include=package-lock.json --include=pubspec.lock \
  --include=go.sum . | grep -v node_modules
grep -n livekit pnpm-lock.yaml

# No imports.
grep -rnE "^[[:space:]]*(import|export)[^;]*['\"]@?livekit[a-zA-Z0-9._/-]*['\"]|require\([[:space:]]*['\"]@?livekit|['\"]package:livekit_client|\"github\.com/livekit/" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  --include='*.dart' --include='*.go' \
  apps packages sdks services examples | grep -v node_modules
```

All of them come back empty.

A bare `grep -i livekit` does **not**, and that is deliberate rather than
an oversight: the name survives in comments that explain what a piece of
code replaced, because the reason a rule exists is often the thing that
was replaced. The full accounting of what remains and why is in
[the migration map](../architecture/native-rtc-migration-map.md#8-removal-and-the-references-that-intentionally-remain).
The short version — the name appears in this guide, in the audit and the
superseded [SFU comparison](../architecture/sfu-comparison.md), in
past-tense code comments, in a category comparison in the README, and in
eight architecture docs that carry a "superseded" banner until they are
rewritten.

---

## What is not done yet

Stated plainly rather than discovered later. Both are tracked in the
[capability matrix](../architecture/native-rtc-migration-map.md#5-capability-matrix).

**Congestion control.** The SFU registers TWCC feedback, so the data is on
the wire, but nothing consumes it to drive simulcast layer selection. A
subscriber on a degrading connection sees packet loss rather than being
dropped to a lower layer. The layer-selection machinery exists; the
estimator that decides does not.

**SFU-side quality verdict.** See `getConnectionQuality()` above.

---

## Where to go next

- [RTC architecture](../rtc/architecture.md) — how the whole thing fits together
- [Signaling protocol](../rtc/signaling.md) — the wire contract
- [SFU](../rtc/sfu.md) — the media plane, and how to operate it
- [Networking](../rtc/networking.md) — ports, NAT, firewalls, TURN
- [Scaling](../rtc/scaling.md) — multiple SFUs, regions, capacity
- [Security](../rtc/security.md) — tokens, secrets, permissions
