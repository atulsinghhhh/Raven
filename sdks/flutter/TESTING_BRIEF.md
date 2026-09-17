# Raven Flutter SDK — External Testing Brief

**For:** an external developer testing the published Flutter packages.
**Against:** the live Raven Cloud API (`https://api.ravenstack.online`).
**Last updated:** 2026-09-17.
**Setup verified:** every API call and gotcha in Section 3 was executed against
production on 2026-09-17 and behaved as documented here. The RTC signaling
socket, the chat REST plane, and the membership rules are live and healthy —
what remains unverified is the *client SDK on real devices*, which is your job.

Read Sections 2 and 3.5 before you start. Section 2 lists defects we already
know about, so you don't spend the engagement rediscovering them. Section 3.5
lists the setup traps that fail silently — most "it doesn't work" reports we
get trace back to one of them.

---

## 1. Scope

| Package | Version | Unit tests | Live Web e2e | Native (iOS/Android) |
| --- | --- | --- | --- | --- |
| `raven_rtc` | 0.1.8 | ~1900 lines, strong | yes | **none** |
| `raven_chat` | 0.1.0 | models/errors/backoff only — **the 786-line client has none** | yes | **none** |
| `raven_live` | 0.1.0 | types only — **`live_stream.dart` has none** | yes | **none** |

Read that table as the shape of the risk. Our unit tests cover signaling and
negotiation logic well. Our end-to-end coverage is real but runs **entirely on
Flutter Web under headless Chromium**. **No native iOS or Android build has
ever been exercised end to end.** That is the gap you are here to close.

Install from pub.dev only — plain version constraints, no `path:` or `git:`
dependencies and no `dependency_overrides`. If your `pubspec.lock` shows
anything other than `source: hosted` for a `raven_*` package, you are not
testing what we shipped. (Note: the packages currently ship **without a
package-level `example/` directory** on pub.dev. Use
`examples/flutter-rtc-chat/` from the repo instead — see Section 3.)

**Platforms in scope:** Web, Android, iOS, macOS. These are the four
`flutter_webrtc 1.6.2+hotfix.3` supports. None of our pubspecs declare a
`platforms:` key, so nothing is formally claimed or excluded — establishing
what actually works is part of what we're asking you to find out.

**A naming quirk, so it doesn't look like a security problem:** the product is
called **Livqeno** in prose and docs, the packages are named `raven_*`, and
the API host is `api.ravenstack.online`. The dashboard lives at
`https://app.livqeno.com` (the older `app.ravenstack.online` still appears in
some docs). All of these refer to the same thing. The inconsistency is real
and it is ours — please do report it as a docs issue, but don't treat it as a
sign you're on the wrong domain.

---

## 2. Known broken — please don't re-report these

### Confirmed defects

**A. Web: a remote video tile never renders a track that arrives after the tile is built.**
In a two-participant call where A joins and publishes first and B joins
several seconds later, **A never sees B's video.** The `<video>` element stays
at `readyState: 0`, `videoWidth: 0`, with no `srcObject` ever assigned.

What makes this deceptive is that *the engine layer is entirely correct
throughout* — `remoteParticipants`, `isCameraEnabled`, and the track handle
all report a live camera. Only rendering fails. B (the second joiner) sees
both tiles correctly.

Status: **unfixed, High severity.** Root cause is not pinned; it sits
somewhere between `RTCVideoRenderer.srcObject`'s setter and `flutter_webrtc`'s
web platform view. We confirmed the Dart-level code runs and passes a valid
`MediaStream`. One structural fix was attempted and did not resolve it.

What *is* useful here: whether the same thing happens on **Android, iOS, or
macOS**. We have only ever reproduced it on Web.

**B. Android: hard crash inside the native WebRTC binary during `join()`.**
Reported signature: `SIGABRT`, backtrace entirely inside
`libjingle_peerconnection_so.so`, `Check failed: false` at `jvm.cc:81`.

Status: **upstream, needs retest.** `raven_rtc` ships no native code or
Android build config; the binary comes from a prebuilt third-party AAR
(`io.github.webrtc-sdk:android:150.7871.01`) that `flutter_webrtc` pulls in.
The original report came from an **unreleased Android API 37.1 preview image
with 16KB page sizes**. We could not reproduce it — but only on that same
class of preview image, which proves little.

**This is the single highest-value thing you can do for us:** run it on a
mainstream Android device or a standard (non-preview, non-16KB-page) emulator
image and tell us whether it crashes. We have no such device available.

### Working as designed — these are not bugs

Each of these looks like a defect and isn't. Filing them costs us both time.

- **`dynacast` is a no-op.** The constructor accepts it and the docs mention
  it, but the SFU does not implement it. It exists for API parity with the web
  SDK.
- **The effects API cannot affect video.** `RavenEffectsPipeline`, the
  filters, and the presets are a **configuration layer only** —
  `ravenEffectsNativeEngineStatus` is permanently `planned`, and `RavenRoom`
  exposes no publish-time track handle for effects to attach to. The pipeline
  validates and stores your config correctly; nothing renders it.
- **`RavenPermissions` cannot check status without prompting.** It works by
  calling `getUserMedia` and immediately stopping the track. There is no
  status-only query, and `permanentlyDenied` is always reported as `false`
  because neither platform exposes that to Dart. Use `permission_handler`
  alongside it if you need pre-flight status.
- **`room.data` has no sender attribution.** The SFU's fan-out does not carry
  identity. If you need to know who sent a payload, put it in the payload.
- **`enableScreenShare()` throws on iOS** unless the host app has a Broadcast
  Upload Extension target. That is an Xcode target, not something a package
  can provide.
- **`RavenLiveStream.leave()` does not end the stream.** Moving a stream from
  `LIVE` to `ENDED` is a separate server-side call
  (`POST /v1/live-streams/:id/end`). `leave()` only disconnects this client.
- **A conversation created with no `members` is unreadable by every client
  chat token.** A project API key isn't a chat user, so there's no creator
  identity to auto-add. Always pass `members`. A non-member gets a `404`, not
  a `403` — that's deliberate, so the API doesn't confirm the conversation
  exists to someone who shouldn't know. Verified live: a member reads history
  (`200`) and sends (`201`); an identity never added to the conversation gets
  `404 RAVEN_CONVERSATION_NOT_FOUND` on the same URL.

---

## 3. Setup

Don't build a harness from scratch. `examples/flutter-rtc-chat/` in this repo
is already a working two-plane app (video + chat) with its own token-minting
backend, and it's the reference we want findings reported against.

### 3.1 Credentials

1. Sign up at **https://app.livqeno.com**.
2. Create a project.
3. Create an API key from the project's **API Keys** tab. It looks like
   `rvk_TugSAioScTjb.<secret>` and **is shown exactly once.**

**The API key is a server credential.** Never put it in the Flutter app — an
app binary is downloadable and inspectable. The app gets short-lived tokens
from your own backend, which is the only thing that holds the key.

**Shortcut if you just want to smoke-test one room:** the dashboard can mint a
token directly — `POST /v1/projects/:projectId/rooms/:roomId/test-token` with
a browser session, full publish grant, fixed 10-minute TTL. Fine for a quick
check, useless for anything multi-participant or longer than 10 minutes.

### 3.2 Run the token backend

```bash
cd examples/flutter-rtc-chat
npm install
RAVEN_API_KEY=rvk_xxx.yyy \
RAVEN_API_URL=https://api.ravenstack.online \
npm run server          # listens on :8791
```

`server.mjs` does the whole credential dance: finds-or-creates the room and
its bound conversation, adds the caller's identity as a conversation member,
and mints **two independent tokens**.

> **RTC tokens and chat tokens are separate credentials and neither works on
> the other plane.** An RTC token is rejected by the chat gateway and vice
> versa. If you see a 401 or a 4401 close code from one plane, check which
> token you passed before assuming anything else.

### 3.3 Run the app

```bash
flutter pub get
flutter run --dart-define=RAVEN_BACKEND_URL=http://<your-lan-ip>:8791
```

Confirm you're on the published packages before you trust any result:

```bash
flutter pub upgrade
grep -A3 "^  raven_" pubspec.lock     # expect raven_rtc 0.1.8, source: hosted
```

### 3.4 API reference, if you write your own backend

Nothing is hardcoded in the SDK — every URL the client uses comes from a mint
response. All of these take `Authorization: Bearer rvk_<publicId>.<secret>`.

| Call | Notes |
| --- | --- |
| `POST /v1/rooms` | `{ name, getOrCreate? }`. `name` is 1–128 chars, `[A-Za-z0-9_.-]`. |
| `POST /v1/rooms/:roomId/rtc-tokens` | `{ participantIdentity, permissions?, ttlSeconds?, metadata? }`. Returns `token`, `endpoint`, `iceServers`, `expiresAt`. |
| `POST /v1/chat/conversations` | `{ name, members?, roomId?, getOrCreate? }`. Server-actor (API key) only. |
| `POST /v1/chat/tokens` | `{ userId, conversations?, scopes?, ttlSeconds? }`. Returns `token`, `chatUrl`, `apiUrl`. A chat token cannot mint another. |
| `POST /v1/live-streams` + `/start`, `/hosts`, `/viewer-tokens`, `/end` | `/hosts` and `/viewer-tokens` return the full `RavenLiveStreamCredentials` shape in one call. |

Both identity fields (`participantIdentity`, `userId`) are 1–128 chars matching
`[A-Za-z0-9_.-]`. Full schema at `https://api.ravenstack.online/docs`; health
check at `/health`.

**Verified live against production on 2026-09-17.** Observed behaviour you can
rely on:

- Default RTC token TTL is **600 seconds (10 minutes)** when `ttlSeconds` is
  omitted. Long enough to join, short enough to expire mid-test — set it
  explicitly for anything longer.
- The RTC token response carries **4 `iceServers` entries**.
- The signaling socket takes the token as a **`token` query parameter**
  (`wss://…/v1/rtc?token=…`), not `access_token` and not a header — a
  WebSocket handshake can't carry auth headers.
- **The SFU sends its `sdp.offer` immediately on connect**, before anything
  else. That ordering is exactly what the 0.1.4 race was about, so it's worth
  knowing the offer really does arrive that early in production.
- Conversations **cannot be deleted**, only archived:
  `PATCH /v1/chat/conversations/:id` with `{"status":"ARCHIVED"}`. Rooms
  delete normally (`DELETE /v1/rooms/:id` → 204). Worth knowing before you
  generate a hundred test conversations.

### The URLs you get back

All connection details come from the mint response — nothing is hardcoded in
the SDK. As of 2026-09-17 these resolve to the custom domain:

```
POST /v1/rooms/:id/rtc-tokens  →  endpoint:     wss://api.ravenstack.online/v1/rtc
                                  telemetryUrl: https://api.ravenstack.online
POST /v1/chat/tokens           →  chatUrl:      wss://api.ravenstack.online/v1/chat/ws
                                  apiUrl:       https://api.ravenstack.online
```

Confirmed end to end on that date: a `101` upgrade on the returned `endpoint`,
followed by the SFU's `sdp.offer` and ICE candidates.

If you ever see a `*.azurecontainerapps.io` hostname in a mint response,
**stop and tell us** — that is a deployment regression, not something to work
around. The API refuses to boot in production with such a value, so it should
not be reachable, but the symptom would be silent for you: everything appears
to work while clients connect to a hostname tied to a disposable resource.

### 3.5 Traps that produce silent or misleading failures

Check these first when something doesn't work. Every one of them fails in a
way that points you somewhere else.

| Trap | Symptom |
| --- | --- |
| **`permissions` omitted when minting an RTC token** *(confirmed live)* | **`publish` defaults to `false`.** You get a subscribe-only token, `enableCamera()` fails, and it looks like the camera is broken. Pass `{ join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true }` explicitly. `publishData` also defaults to `false` — set it if you're testing `sendData()`. |
| **Flutter Web origin blocked** *(only if you've configured origins)* | The per-project allow-list is **opt-in: an empty list allows every origin**, which is the default, so most testers will never hit this. If someone *has* populated it, an unlisted origin gets a **plain 403** on chat HTTP routes and a WebSocket close on the chat/signaling sockets — never a CORS error, so it won't look like an origin problem. Add your `http://localhost:PORT` under **Project Settings → Security → Allowed Origins**, or enable the localhost exemption. |
| Conversation created without `members` *(confirmed live)* | Every client chat token gets a 404 (`RAVEN_CONVERSATION_NOT_FOUND`). Creating it as the API key still returns 201, so the failure only shows up later, from the client. See Section 2. |
| `localhost` in `RAVEN_BACKEND_URL` on a real device | `localhost` means *the phone*. Use your machine's LAN IP, and make sure the `endpoint` the backend returns is reachable from the device too. |
| Testing video on a simulator | Simulators have no camera. Video will never work. Use real hardware. |
| `minSdkVersion` below 23 | Android build failure; WebRTC won't compile below it. |
| Missing iOS usage strings | Missing `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` **crashes the app** the instant it asks. It does not raise an error you can catch. |
| Missing Android permissions | Need `CAMERA`, `RECORD_AUDIO`, `INTERNET`, `MODIFY_AUDIO_SETTINGS` in the manifest. |
| `http://` / `ws://` endpoints on Android | Android blocks cleartext by default. Use `https://` and `wss://`. |
| Wi-Fi works, cellular doesn't | Carrier NAT requires TURN. Forward the `iceServers` from the token response into the `Raven` constructor. |
| Black video, no error at all | Permissions. Call `RavenPermissions.request()` and check the returned map. |
| Token expired mid-test | The default RTC token TTL is **10 minutes** (confirmed live). Pass `ttlSeconds` (30–21600) or wire up `refreshToken` / `onTokenExpiring`. |

### 3.6 If you adapt the backend

`server.mjs` does find-then-create for rooms, which can lose a race and return
a raw `409` if two clients create the same room simultaneously. `POST /v1/rooms`
accepts **`getOrCreate: true`** for idempotent creation (both callers get the
same room id). Omitting it deliberately preserves the hard 409 — that default
is intentional, not an oversight. `POST /v1/chat/conversations` takes the same
flag.

Both halves confirmed live: two `getOrCreate: true` calls for the same name
returned the identical room id, and two calls without it returned `201` then
`409 RAVEN_CONFLICT`.

---

## 4. Test matrix

Fill this in and send it back. This grid is the primary thing we want.

| # | Scenario | Web | Android | iOS | macOS |
| --- | --- | --- | --- | --- | --- |
| 1 | Two-participant call, ordered join | ⚠️ known-fail (A) | ❓ | ❓ | ❓ |
| 2 | `join` + camera + mic on a mainstream device | ❓ | 🔴 **priority (B)** | ❓ | ❓ |
| 3 | `RavenChat` end-to-end | e2e-covered | ❓ | ❓ | ❓ |
| 4 | `RavenLiveStream` join / react / leave | e2e-covered | ❓ | ❓ | ❓ |
| 5 | `RavenVideoView` lifecycle | ❓ | ❓ | ❓ | ❓ |
| 6 | Local self-preview timing | ❓ | ❓ | ❓ | ❓ |
| 7 | Mute vs disable semantics | ❓ | ❓ | ❓ | ❓ |
| 8 | `switchCamera()` | n/a | ❓ | ❓ | n/a |
| 9 | Screen share | ❓ | ❓ | ❓ | ❓ |
| 10 | Permission prompts + denial recovery | ❓ | ❓ | ❓ | ❓ |
| 11 | Late joiner sees existing roster | ❓ | ❓ | ❓ | ❓ |
| 12 | Reconnect / background / network switch | ❓ | ❓ | ❓ | ❓ |
| 13 | `sendData()` edge cases | e2e-covered | ❓ | ❓ | ❓ |

Legend: ✅ pass · ❌ fail · ⚠️ known-fail · ❓ untested · n/a not applicable ·
🔴 highest priority · *e2e-covered* = we have automated Web coverage, so
confirm rather than explore.

Record the OS version and device model per column. For Android, **state
explicitly whether the image is a preview or 16KB-page build** — a result on a
preview image doesn't answer question B.

**The whole Android, iOS and macOS side of this grid is empty today.** That is
not an oversight in this brief; it's the actual state of our knowledge.

---

## 5. Scenarios

### P0 — these decide whether the SDK ships

**1. Two-participant call, both directions, ordered join.**
Client A joins and publishes camera + mic. Wait ~8 seconds. Client B joins and
publishes. Then check **each direction separately**:
- Does A render B's video? (Known-fail on Web — issue A.)
- Does B render A's video?
- Does each client render its own local preview?

Repeat with both joining simultaneously, and again with B joining first. We
have a report that the *second* joiner also loses its own local preview, which
we could never reproduce — if you see it, that repro is valuable.

**2. Android on a mainstream device.**
Minimum flow: `Raven(...)` → `join()` → `enableCamera()` → `enableMicrophone()`
→ wait → `leave()`. Capture **full logcat regardless of whether it crashes** —
a clean run on a mainstream image is exactly the evidence we're missing.
Explicitly not a 16KB-page preview image; not API 37.x.

**3. `RavenChat` on native.** The client has no unit tests; our only coverage
is a Flutter **Web** e2e suite. Re-run its scenarios on iOS and Android, where
nothing has ever been tried:
- Connect handshake — `connect()` should resolve only after server auth, not
  at TCP open.
- `send()` while connected.
- **`send()` with the socket forcibly down** — it's supposed to fall back to an
  HTTP POST. Verify the message actually lands.
- Kill the network and restore it: bounded exponential backoff, and the client
  must **re-join its rooms** on the new socket. On mobile, also test
  backgrounding the app for several minutes.
- `onTokenExpiring` refresh fires and the new token is used.
- Confirm all seven event streams fire: `messages`, `messageUpdates`,
  `messageDeletions`, `typing`, `presence`, `reactions`, `readReceipts`.
- **Idempotency:** send the same `clientMessageId` twice across a reconnect.
  Exactly one message stored; the retry returns the original.
- History pagination both directions (`before` / `after`), plus `edit`,
  `delete` (soft — expect a tombstone with no body), and `thread`.
- A rejected token (close codes 4401/4403) must be **terminal** — no reconnect
  loop.

**4. `RavenLiveStream` join / react / leave.** Same situation: Web e2e exists,
native has nothing.
- `join()` must connect the room first, then chat.
- **The rollback path specifically:** if chat connect throws, `join()` must
  leave *and* dispose the room rather than leaking it. Force this with
  deliberately bad chat credentials, then verify no room connection survives.
- `react()` must throw `RavenChatException(notInRoom)` when the stream has no
  chat attached.
- Host vs viewer publish permission is enforced **server-side by the token
  grant**, not by the client. Confirm a viewer token genuinely cannot publish.
- Remember `leave()` does not end the stream (Section 2).

### P1 — media correctness

**5. `RavenVideoView` lifecycle.** Rebuilds, and a scrolling grid of tiles —
the widget disposes its native texture with the widget, and dropping that is
how a grid leaks a native view per rebuild. Watch memory over a few minutes of
scrolling. Also check mirror defaults (mirrored for local camera only), the
placeholder→video swap, and adaptive layer requests at real widths (under
240px should request `low`, under 640 `medium`, else `high`).

**6. Local self-preview timing** — the 0.1.8 fix. The local tile should appear
as soon as the camera is captured, *before* `enableCamera()` resolves. If you
see a stuck local placeholder on 0.1.8, that's new and we want it.

**7. Mute vs disable.** `setMicrophoneMuted` / `setCameraMuted` keep the track
published; `disableCamera` / `disableMicrophone` unpublish it. The remote peer
should observe a different result for each. Round-trip both several times.

**8. `switchCamera()`** front↔rear on Android and iOS. Confirm it throws
`RavenErrorCode.deviceNotFound` when no camera is currently publishing.

**9. Screen share.** Android should show the system consent dialog and work out
of the box. iOS requires a Broadcast Upload Extension — please actually add
one and test it, since that path has never been exercised by anyone.

### P2 — connection and permissions

**10. Permissions.** `RavenPermissions.request()` and `require()` on iOS and
Android: grant, deny, and the recovery path through OS settings. Note the known
limitation in Section 2 before filing anything here.

**11. Late joiner sees the existing roster** — the 0.1.6 fix. Attach a
`participantChanges` listener *after* `join()` has already returned; it must
still receive the current roster. This is the "viewer joins a live stream in
progress and sees an empty grid" case.

**12. Reconnect.** Background and foreground the app; switch Wi-Fi→cellular
mid-call; drop the network entirely and restore it. Video capture is expected
to stop when backgrounded (the OS suspends the camera) and resume on return.
On iOS, audio only survives backgrounding if you've added the `audio`
background mode. Also worth probing: token revocation (`DELETE` on either
token endpoint) mid-session, and how the client surfaces a `503`
`RAVEN_CAPACITY_EXCEEDED`.

**13. `sendData()` edge cases** — the 0.1.5 fix. Call it before the data
channel has opened (should queue, not drop), and from a receive-only
participant that has published nothing (should still negotiate a channel).
Remember `publishData` must be `true` on the token (Section 3.5).

### P3 — documentation

**14.** Work through `docs/sdk/flutter.md` start to finish as though you'd
never seen this SDK, and report every place it doesn't compile or doesn't
match reality. We've just fixed the ones we knew about; anything else you find
is a genuine finding. The published docs site is a separate, thinner copy —
discrepancies between the two are also worth reporting.

---

## 6. How to decide something passed

This is the most important rule in this document, because it's the one we got
wrong ourselves.

> **Signaling success is not media success, and engine flags are not
> rendering.**

In the investigation that produced issue A, `connectionState == connected` was
true, `remoteParticipants` was correct, and `isCameraEnabled` was `true` for
the remote peer — while **no video was rendering at all**. Every engine-level
signal said the call was fine. It wasn't.

So a scenario counts as passing only when you've confirmed the picture is
actually moving:

- **On Web:** sample `RTCPeerConnection.getStats()` twice, several seconds
  apart, and confirm **both `framesDecoded` and `bytesReceived` strictly
  increased**. Additionally inspect the `<video>` element itself —
  `readyState`, `videoWidth`, and whether `srcObject` is set.
- **On native:** visually confirm live motion (wave at the camera), and attach
  a screen recording. A static first frame is not a pass.

Signaling completing, a participant appearing in the roster, or a flag flipping
to `true` are all necessary and none of them are sufficient.

---

## 7. Reporting findings

One report per finding, please, with:

1. **Package and exact version** (from `pubspec.lock`, including `source:`).
2. **Platform, OS version, device model.** For Android, state whether the image
   is a preview / 16KB-page build.
3. **Exact repro steps**, including join order and timing if more than one
   client is involved.
4. **Expected vs actual.**
5. **Evidence:** full logcat or browser console output, the `getStats` numbers
   from Section 6, or a screen recording.
6. **Does it reproduce on `examples/flutter-rtc-chat` unmodified?** If it only
   happens in your own app, tell us — the difference is usually the clue.

If a scenario passes, say so explicitly. A filled-in matrix with confirmed
passes is worth as much to us as a bug report, because almost none of these
cells have ever been confirmed on real hardware.
