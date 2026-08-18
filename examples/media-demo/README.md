# Media Demo (Phase 4)

A minimal static HTML page proving real WebRTC media through LiveKit (our
selected SFU) — actual camera/microphone, not a mock. No build step, no
CDN dependency: `livekit-client.umd.js` is vendored directly into this
folder (LiveKit's official browser SDK, v2.22.0), so the page works fully
offline once you have it.

This is deliberately not the production dashboard — see
`docs/sfu.md`/`docs/media-flow.md` for the architecture this exercises.

## Running it

1. `pnpm infra:up` from the repo root.
2. Get an RTC token for a room (Swagger UI at `http://localhost:4100/docs`,
   `pnpm db:seed`, or curl):

   ```bash
   curl -X POST http://localhost:4100/v1/rooms/<roomId>/rtc-tokens \
     -H "Authorization: Bearer <api-key>" \
     -H "Content-Type: application/json" \
     -d '{"participantIdentity":"alice","permissions":{"join":true,"subscribe":true,"publish":true,"publishAudio":true,"publishVideo":true}}'
   ```

3. Serve this folder over HTTP (browsers restrict camera/microphone
   access on `file://` pages) — e.g. `python3 -m http.server 8899` from
   inside `examples/media-demo/`, then open `http://localhost:8899/`.
4. Paste the **entire JSON response** from step 2 into the textarea and
   click **Join Room**.
5. Click **Camera** and **Mic** to publish. Grant the browser permission
   prompts.
6. Repeat with a second `participantIdentity` (same room) in another tab
   or device — each sees the other's video/audio appear automatically
   under "Remote participants". Try a 3rd and 4th identity for a group
   call.

## What this proves

- Publishing camera/microphone through LiveKit
- Subscribing to another participant's tracks
- Group calls (3-4 participants) via one SFU rather than a full mesh
- Connection state transitions (connecting → connected → disconnected)
- TURN credentials from the token response actually working (test by
  disabling direct UDP or using a restrictive network — see
  `docs/sfu.md#turn-integration`)

## What this intentionally does not do

No recording, no transcoding, no chat — see `docs/sfu.md#what-was-not-built`.
