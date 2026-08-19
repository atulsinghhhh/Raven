# Effects Demo

A real, single-browser demo of Raven Effects — one camera, one
`EffectsPipeline`, side-by-side "Original" vs "Processed" `<video>`
elements. No RTC room, no signaling server, no backend: `attachEffects()`
on an RTC `LocalTrack` does exactly what this page does directly against
a `getUserMedia()` track — this demo isolates that step so it can run
with nothing but a static file server.

`app.js` imports only `@corvidhq/effects`. Selecting a filter mutates the
same running pipeline (`pipeline.clear()` + `pipeline.applyPreset()`/`add()`)
rather than reattaching — the processed video updates live because the
engine reads the pipeline's effect list fresh every frame.

## Running it

**1. Build the SDK bundle this demo vendors** (no bundler, no CDN — same
convention as `examples/live-streaming-demo`):

```bash
pnpm --filter @corvidhq/effects run build
cd examples/effects-demo
cp ../../packages/effects/dist/index.js{,.map} .
mv index.js raven-effects.js; mv index.js.map raven-effects.js.map
```

**2. Serve this directory** (needs to be `http://` or `https://` for
`getUserMedia()` — opening `index.html` as a `file://` URL won't work):

```bash
python3 -m http.server 8080
```

**3. Open `http://localhost:8080`**, grant camera access, and click
through the filter buttons — Original, Warm, Cool, Cinematic, Vivid,
Vintage, Beauty, Blur. The "Processed" video updates immediately; the
"Original" video never changes, so you can compare them side by side.

The status line under the videos reports which engine actually picked up
(`webgl2`, `canvas2d`, or `passthrough`) and, once running, the live
`fps`/`averageFrameTimeMs`/`droppedFrames` this specific browser and
camera are producing — not a hardcoded number.

## What this proves

- A real camera frame goes through a real WebGL2 (or Canvas2D fallback)
  pipeline and comes out visibly different — no screenshots, no CSS
  filters standing in for the result.
- Switching filters/presets at runtime, with no re-negotiation or track
  restart (the same output `MediaStreamTrack` keeps playing throughout).
- Capability detection choosing an engine automatically, and graceful
  degradation (`passthrough`) if this browser can't run the pipeline.
