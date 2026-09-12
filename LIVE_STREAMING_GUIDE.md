# Live Streaming — Implementation Guide

A self-contained guide for adding Livqeno Live Streaming to your app: one host
publishing camera/mic, any number of viewers watching, plus chat and
reactions. This covers the interactive (`RTC_ONLY`) mode — the same one
`examples/live-streaming-demo` runs end to end in two browser tabs.

If you get stuck, that example is a working reference: `examples/live-streaming-demo/README.md`.
For anything not covered here, the full docs are at
**docs.ravenstack.online** (section links at the bottom).

---

## 1. Architecture — who calls what

```
Your backend  ──API key──▶  Livqeno Control API  ──▶ short-lived credentials
     │                        (api.ravenstack.online)
     │
     └──credentials──▶  Your frontend  ──▶  LiveStream.join()  ──▶  Livqeno SFU
```

**Rule that matters most:** your `RAVEN_API_KEY` is permanent and must never
leave your backend. Your backend calls the Control API and hands the browser
only the short-lived `credentials` object it gets back. The browser never
talks to the Control API directly.

There are two delivery modes for a stream:

| Mode | How viewers watch | Covered here |
|---|---|---|
| `RTC_ONLY` (default) | Real-time WebRTC, sub-second latency, subscribe-only viewer | ✅ this guide |
| `BROADCAST` | HLS via the egress worker, higher latency, scales to large audiences | No — see `docs.ravenstack.online/live-streaming/streams` and `GET /v1/live-streams/:id/playback` |

---

## 2. Install

Backend (Node):
```bash
npm install @ravenkash/server
```
(Python backend? Not on PyPI yet — install from source: `pip install "git+https://github.com/atulsinghhhh/Raven.git#subdirectory=sdks/python"`. Same methods, snake_case: `raven.live_streams.create(...)`, etc. Do **not** `pip install raven` or `pip install raven-sdk` — both names belong to unrelated third parties.)

Frontend:
```bash
npm install @ravenkash/client
```

Env vars for your backend:

| Var | Required | Notes |
|---|---|---|
| `RAVEN_API_KEY` | yes | Secret. Server-side only. Never send to the browser. |
| `RAVEN_API_URL` | yes in production | Set explicitly, e.g. `https://api.ravenstack.online` (or your self-hosted deployment). Omitting it falls back to `http://localhost:4100` — fine locally, but the SDK now throws rather than silently connecting to that in production (`NODE_ENV=production` with no `baseUrl`/`RAVEN_API_URL`). |

---

## 3. Backend — mint host credentials

One route in your app, gated by your own auth. This creates the stream and
immediately mints the host's own credentials:

```ts
import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL!,
});

app.post('/api/streams', requireYourOwnAuth, async (req, res) => {
  const stream = await raven.liveStreams.create({
    title: req.body.title,
    hostIdentity: req.user.id,          // identity comes from YOUR session, never the request body
  });

  const hostCreds = await raven.liveStreams.addHost(stream.id, {
    identity: req.user.id,
    role: 'HOST',
  });

  // Forward only what the browser needs to join — never the API key.
  res.json({
    streamId: stream.id,
    chatRootMessageId: stream.chatRootMessageId,
    role: hostCreds.role,
    rtc: hostCreds.rtc,
    chat: hostCreds.chat,
  });
});

app.post('/api/streams/:id/start', requireYourOwnAuth, async (req, res) => {
  res.json(await raven.liveStreams.start(req.params.id));
});

app.post('/api/streams/:id/end', requireYourOwnAuth, async (req, res) => {
  res.json(await raven.liveStreams.end(req.params.id));
});
```

A stream is created in `CREATED` status — it isn't visible as "live" to
viewers until you call `start()`. Call `start()` **after** the host has
actually enabled camera/mic (step 4), not before — otherwise you can end up
with a "live" stream that has no media yet.

## 4. Backend — mint viewer credentials

Viewers only ever hit this one endpoint. It never has a HOST option — the
server always mints subscribe-only credentials, regardless of anything the
client sends:

```ts
app.post('/api/streams/:id/viewer-tokens', requireYourOwnAuth, async (req, res) => {
  const [streamInfo, viewerCreds] = await Promise.all([
    raven.liveStreams.get(req.params.id),
    raven.liveStreams.createViewerToken(req.params.id, { identity: req.user.id }),
  ]);

  res.json({
    streamId: req.params.id,
    chatRootMessageId: streamInfo.chatRootMessageId,
    role: viewerCreds.role,             // always 'VIEWER'
    rtc: viewerCreds.rtc,
    chat: viewerCreds.chat,
  });
});
```

This returns `409 STREAM_DELIVERY_MODE_MISMATCH` if the stream is in
`BROADCAST` mode — that mode's viewers use `GET /v1/live-streams/:id/playback`
instead (an HLS URL, no RTC join at all).

## 5. Frontend — host

```ts
import { LiveStream } from '@ravenkash/client';

const grant = await fetch('/api/streams', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'My Live Stream' }),
}).then((r) => r.json());

const stream = await LiveStream.join(grant);   // stream.role === 'HOST', stream.isHost === true

stream.room.on('connectionStateChanged', (state) => console.log('RTC:', state));
stream.room.on('trackSubscribed', (track, participant) => {
  if (track.kind === 'camera') track.attach(remoteVideoEl);   // a co-host's camera, not your own
});

await stream.room.enableCamera();
await stream.room.enableMicrophone();

// Your own local preview — a LocalTrack, attach it separately from remote tracks.
const myCamera = stream.room.localParticipant.tracks.find((t) => t.kind === 'camera');
myCamera?.attach(selfPreviewEl);

// Now flip the stream to LIVE.
await fetch(`/api/streams/${grant.streamId}/start`, { method: 'POST' });
```

## 6. Frontend — viewer

```ts
const grant = await fetch(`/api/streams/${streamId}/viewer-tokens`, { method: 'POST' })
  .then((r) => r.json());

const stream = await LiveStream.join(grant);   // stream.role === 'VIEWER', publish is refused server-side no matter what

stream.room.on('trackSubscribed', (track, participant) => {
  if (track.kind === 'camera') track.attach(remoteVideoEl);
});

// If the host was already live before you joined, its tracks arrive
// synchronously here — trackSubscribed only fires for arrivals *after* this.
for (const participant of stream.room.remoteParticipants) {
  for (const track of participant.tracks) {
    if (track.kind === 'camera') track.attach(remoteVideoEl);
  }
}
```

`stream.isHost` is a client-side convenience flag only. The real permission
check is server-side: a viewer's RTC token always has publish disabled,
regardless of what the client claims.

## 7. Chat and reactions (both roles, identical code)

```ts
stream.chat?.on('message', (msg) => console.log(`${msg.senderId}: ${msg.text}`));
stream.chat?.on('reactionAdded', (event) => console.log(`${event.userId} reacted ${event.emoji}`));

await stream.chat?.sendMessage({ text: 'hello!' });
await stream.react('❤️');   // throws if there's no chat, or no chatRootMessageId in the grant
```

Chat only works if your backend forwarded `chat` credentials and
`chatRootMessageId` in the grant — both come straight from the stream/host
responses in steps 3–4, don't hand-construct them.

## 8. Ending the stream

```ts
await fetch(`/api/streams/${streamId}/end`, { method: 'POST' });   // host-side, backend call
await stream.leave();                                              // host's own client leaves the room
```

**Known gap (observed running this locally, not just in the docs):** ending
a stream does not push a "stream ended" event to connected viewers — their
`room` just sees the underlying RTC connection drop, and the demo's own UI
keeps showing the last video frame frozen with `status: connected`. If your
UI needs an explicit "this stream has ended" state for viewers, listen for
`stream.room.on('connectionStateChanged', ...)` transitioning away from
`connected`/`reconnecting`, or poll `GET /v1/live-streams/:id` for
`status === 'ENDED'`. Don't rely on a dedicated end-of-stream event — there
isn't one on the wire today.

---

## 9. Errors and rate limits to handle

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `RAVEN_CAPACITY_EXCEEDED` | 503 | SFU at concurrency ceiling | Retryable — check `retryAfterSeconds` in the error body and back off |
| `STREAM_INVALID_STATE` | 409 | e.g. calling `start()` twice, writing to an `ENDED` stream | Not retryable — check current `status` first |
| `STREAM_NOT_FOUND` | 404 | Wrong ID, or a stream from another project | Not retryable |
| `STREAM_DELIVERY_MODE_MISMATCH` | 409 | Called `viewer-tokens` on a `BROADCAST` stream | Use `GET .../playback` instead for that stream |

Endpoint rate limits worth designing around if you expect bursts (e.g. a
popular stream getting many viewers at once): `create` 30/min,
`hosts` 60/min, `viewer-tokens` 120/min — stagger viewer joins client-side
(e.g. small random delay) if you expect hundreds joining in the same second.

`viewerCount` in the stream response can be `null` — that means the SFU was
unreachable when the count was read, **not** that there are zero viewers.
Don't render `null` as "0 viewers."

---

## 10. Local testing

Everything above already runs locally: `examples/live-streaming-demo` is a
working two-tab (host + viewer) implementation of exactly this flow, built
on the same `@ravenkash/client` `LiveStream.join()` API — see its README for
exact run steps (`pnpm infra:up`, build the vendored SDK bundles, run its
FastAPI backend + static server). It's the fastest way to confirm your API
key and local infra work before wiring your own app.

---

## 11. Going further

This guide covers the RTC_ONLY happy path end to end. For anything beyond
it, see the full docs at **docs.ravenstack.online**:

- `/live-streaming/quickstart` — same flow, more detail
- `/live-streaming/moderation` — removing hosts, muting, banning
- `/live-streaming/events` — webhooks (`live_stream.egress_failed`, etc.)
- `/live-streaming/analytics` — viewer/engagement metrics
- `/live-streaming/network-quality` — reconnect/quality event handling
- `/live-streaming/filters` — camera effects/filters during a stream
- `/live-streaming/sdk-support` — React / React Native / Flutter wrappers
- `/api/live-streams` — full REST reference (every field, every DTO)
