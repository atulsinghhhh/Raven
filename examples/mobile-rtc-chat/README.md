# Raven React Native example — video call with chat

A real Raven call on a phone: WebRTC media through Raven's SFU, messages
through Raven Chat into Postgres. No mock participants, no fake message
array.

## Running it

Needs the Raven stack up (`pnpm infra:up` from the repo root) and a
project API key.

```bash
cd examples/mobile-rtc-chat
npm install
cd ios && pod install && cd ..     # iOS only

# Terminal 1 — backend that holds RAVEN_API_KEY and mints both tokens
RAVEN_API_KEY=rvk_xxx.yyy npm run server

# Terminal 2
npm run ios      # or: npm run android
```

**On a real device, `localhost` means the phone.** Point `BACKEND_URL` in
`src/App.tsx` at your machine's LAN IP, and make sure `RAVEN_API_URL`
and the returned `livekitUrl` are reachable from the device too — the
defaults point at `localhost` and will fail on hardware.

## What it demonstrates

Remote video, a local preview, camera and microphone toggles, a chat
panel with history and typing indicators, and leaving cleanly.

Two devices in the same room see and hear each other, and messages sent
from one appear on the other.

## What the app never does

No `new WebSocket(...)`. No `registerGlobals()`. No audio session
management, reconnect loop, heartbeat, message ordering, or dedupe.
That's all inside the SDK — which is the point.

## Testing it properly

The interesting cases are the mobile ones:

- **Background and return.** Video capture stops and resumes; the call
  survives.
- **Wi-Fi → cellular.** Install `@react-native-community/netinfo` and the
  reconnect is fast rather than waiting out an ICE timeout.
- **Deny the camera.** The app still joins — you can watch and listen.
- **Kill the app mid-call.** The other device sees you leave once
  presence expires.

See [docs/sdk/react-native.md](../../docs/sdk/react-native.md).
