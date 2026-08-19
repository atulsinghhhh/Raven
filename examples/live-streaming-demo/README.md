# Live Streaming Demo

A real two-browser demo of Raven Live Streaming — one host tab publishing
camera/microphone, one viewer tab receiving real media, plus live chat and
reactions — built entirely on `@corvidhq/client`'s `LiveStream` API
(`raven.live.join()` / `LiveStream.join()`). `app.js` never touches
LiveKit, SDP, or `RTCPeerConnection` directly.

This is deliberately not a polished product UI — see
`docs/live-streaming/overview.md` for the architecture this exercises.

## Running it

**1. Bring up Raven's infrastructure** (from the repo root): `pnpm infra:up`

**2. Get a real API key** — `raven keys create`, the dashboard, or `pnpm db:seed`.

**3. Build the three SDK bundles this demo vendors** (no bundler, no CDN — same convention as `examples/media-demo` and `examples/video-call`):

```bash
pnpm --filter @corvidhq/rtc --filter @corvidhq/chat --filter @corvidhq/client run build
cd examples/live-streaming-demo
cp ../../packages/sdk/dist/index.js{,.map} .
mv index.js raven-rtc.js; mv index.js.map raven-rtc.js.map
cp ../../packages/chat-sdk/dist/index.js{,.map} .
mv index.js raven-chat.js; mv index.js.map raven-chat.js.map
cp ../../packages/client/dist/index.js{,.map} .
mv index.js raven-client.js; mv index.js.map raven-client.js.map
cp ../../packages/sdk/node_modules/livekit-client/dist/livekit-client.esm.mjs .
```

**4. Start the backend** (mints tokens with a real API key — never sent to the browser):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
RAVEN_API_KEY=rvk_xxxx.yyyy uvicorn server:app --port 8790
```

**5. Serve the page**: `python3 -m http.server 8891`

**6. Host tab**: open `http://localhost:8891/?role=host`, enter a title
and identity, click **Create + Go Live**. Grant the camera/microphone
permission prompts. Copy the Stream ID shown.

**7. Viewer tab**: open `http://localhost:8891/?role=viewer&stream=<id>`
(or paste the id manually), enter an identity, click **Join Stream** —
the host's video should appear within a couple of seconds.

**8. Chat both ways, react from the viewer tab, then End Stream from the host tab.**

## What this proves

- A host publishing real camera/microphone through `LiveStream.join()` →
  `stream.room.enableCamera()`/`enableMicrophone()` — ordinary
  `@corvidhq/rtc` `Room` methods, not anything live-streaming-specific.
- A viewer receiving that media over a real SFU connection, with
  publish permission denied server-side (the viewer's RTC token is
  always subscribe-only, regardless of anything the browser sends).
- Chat both ways over the stream's auto-attached conversation, using
  `@corvidhq/chat` exactly as documented elsewhere — no second chat
  implementation.
- Reactions landing on the stream's `chatRootMessageId`, aggregated on
  the existing `Reaction` model.
- The full lifecycle: create → start → (media/chat/reactions flow) →
  end, with the backend enforcing every transition.
