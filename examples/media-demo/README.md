# Media Demo

A minimal static page proving real WebRTC media through `@corvidhq/rtc` —
actual camera/microphone, not a mock — plus a small FastAPI backend
using `raven-sdk` to mint tokens and surface project diagnostics.

This is built entirely on Raven's public SDKs: `app.js` never touches
SDP, ICE candidates, `RTCPeerConnection`, or any type specific to the
media server underneath. `raven-rtc.js` is a vendored, self-contained
ESM bundle (no build step, no CDN — see "Why an import map" below);
nothing here talks to the media server directly.

This is deliberately not the production dashboard — see
`docs/rtc/architecture.md` and `docs/rtc/sfu.md` for the architecture
this exercises.

## Running it

**1. Bring up Raven's infrastructure** (from the repo root):

```bash
pnpm infra:up
```

**2. Get a real API key** — `raven keys create` (see `docs/cli.md`), or
the dashboard's API Keys tab, or `pnpm db:seed` for a demo one.

**3. Start the backend** that mints tokens for this page:

```bash
cd examples/media-demo
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # installs raven-sdk from the local sdks/python source
RAVEN_API_KEY=rvk_xxxx.yyyy uvicorn server:app --port 8788
```

**4. Serve this folder over HTTP** (browsers restrict camera/microphone
access on `file://` pages), on a *different* port than the backend:

```bash
python3 -m http.server 8899
```

**5. Open `http://localhost:8899/`.** Enter a room name and an identity,
click **Join Room** — the page asks the backend for a token itself; you
never touch the Control API or paste JSON by hand. Click **Camera** and
**Mic** to publish, granting the browser's permission prompts.

**6. Repeat with a different identity** (same room name) in another tab
or device — each sees the other's video/audio appear automatically
under "Remote participants". Try a 3rd and 4th identity for a group
call.

## What this proves

- Publishing camera/microphone through `@corvidhq/rtc`
- Subscribing to another participant's tracks
- Group calls (3-4 participants) via one SFU rather than a full mesh
- Connection state transitions (connecting → connected → disconnected)
- Real per-track media stats — bitrate, packet loss, jitter, round-trip
  time, codec — from `room.getConnectionStats()`, the SDK's actual
  public diagnostics surface (see "Live connection stats" on the page)
- Real project-level infrastructure health from
  `raven.diagnostics.get()` (the Python SDK's
  `raven/resources/diagnostics.py`), server-side and independent of
  whether this page itself is connected to anything

## What this intentionally does not do

No recording, no transcoding, no chat — see
`docs/rtc/sfu.md#known-gaps`. It also doesn't attempt to prove TURN
relay specifically; disable direct UDP or use a restrictive network and
watch `iceServers` do its job, or see `docs/turn.md`.

## Why an import map instead of a bundler

Every other JS example in this repo (`examples/rtc-chat`,
`examples/video-call`) is plain static HTML/JS with vendored
dependencies — no build step. This example follows the same
convention: `raven-rtc.js` (`@corvidhq/rtc`'s own ESM build) is
vendored here — one file, since the SDK has no runtime dependency to
vendor alongside it — and an
[import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)
in `index.html` resolves the bare `@corvidhq/rtc` specifier `app.js`
imports — so `app.js` is exactly what a real app's code would look
like after a bundler (Vite, webpack, esbuild) resolves that import;
only the resolution mechanism differs.

To refresh the vendored files after an SDK change:

```bash
pnpm --filter @corvidhq/rtc build
cp ../../packages/sdk/dist/index.js ./raven-rtc.js
cp ../../packages/sdk/dist/index.js.map ./raven-rtc.js.map
```

In a real project, you would simply `npm install @corvidhq/rtc` and let
your own bundler handle resolution — you would not vendor or copy any
files.
