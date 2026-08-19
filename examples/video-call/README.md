# Raven video-call example

A minimal two-participant video call built entirely on `@corvidhq/rtc`'s public
API — `app.js` never touches SDP, ICE candidates, `RTCPeerConnection`, or any
LiveKit-specific type.

```js
import { createRTCClient } from '@corvidhq/rtc';

const client = createRTCClient({ token, endpoint, iceServers });
const room = await client.join(roomName);

await room.enableCamera();
await room.enableMicrophone();

room.on('trackSubscribed', (track, participant) => {
  document.body.appendChild(track.attach());
});
```

## Running it

1. Bring up Raven's infrastructure (from the repo root) and build the SDK:
   ```bash
   pnpm infra:up
   pnpm --filter @corvidhq/rtc build
   ```
2. Copy the freshly-built SDK and its `livekit-client` dependency into this
   folder (this example loads them via a browser import map, not a bundler
   — see below for why):
   ```bash
   cp ../../packages/sdk/dist/index.js ./raven-rtc.js
   cp ../../packages/sdk/dist/index.js.map ./raven-rtc.js.map
   cp ../../packages/sdk/node_modules/livekit-client/dist/livekit-client.esm.mjs ./
   ```
3. Serve this folder statically, e.g.:
   ```bash
   python3 -m http.server 8900
   ```
4. Mint two RTC tokens for the same room (different `participantIdentity`
   values) via Swagger UI at `http://localhost:4100/docs`, or `curl` — see
   docs/sdk.md#authentication for the exact fields you need.
5. Open `http://localhost:8900` in two browser tabs, paste one token's JSON
   response into each, and click **Join Room** in both.

## Why an import map instead of a bundler

Every other example in this repo (`examples/media-demo`,
`examples/signaling-demo`) is plain static HTML/JS with a vendored
dependency — no build step. This example follows the same convention:
`raven-rtc.js` (the SDK's own ESM build) and `livekit-client.esm.mjs`
(livekit-client's own self-contained ESM bundle) are vendored here, and an
[import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)
in `index.html` resolves the bare `@corvidhq/rtc` / `livekit-client` specifiers
`app.js` imports — so `app.js` is exactly what a real app's code would look
like after a bundler (Vite, webpack, esbuild) resolves those same imports;
only the resolution mechanism differs. Import maps are supported in all
current Chrome, Firefox, Safari, and Edge versions (Phase 6 spec §4's
target browsers).

In a real project, you would simply `npm install @corvidhq/rtc` and let your
own bundler handle resolution — you would not vendor or copy any files.
