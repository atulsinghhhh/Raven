---
title: Examples
description: Real, runnable apps in the Raven repo — grouped by which product they exercise.
---

Every example below is a real, runnable app at `examples/<name>` in the
Raven repo — not a code snippet. Each has its own README with exact
setup steps.

## RTC

- **`video-call`** — a minimal two-participant call built entirely on
  `@raven/rtc`'s public API.
- **`react-video-call`** — the same call built with `@raven/react`:
  join a room, camera/microphone, screen sharing, device selection.
- **`mobile-rtc-chat`** — a real call on a phone (React Native).
- **`flutter-rtc-chat`** — the same, in Flutter.
- **`signaling-demo`** — a single static HTML file exercising the
  signaling layer directly, no build step.

## Chat

- **`chat`** — a working chat client on `@raven/chat` and
  `@raven/react` — every message really is round-tripping through
  Postgres and a WebSocket.
- **`rtc-chat`** — `@raven/rtc` and `@raven/chat` on the same screen,
  doing separate jobs: a call with a chat panel.

## Live Streaming

- **`live-streaming-demo`** — a two-browser demo: one host tab
  publishing camera/microphone, one viewer tab receiving real media,
  plus live chat and reactions, built entirely on `@raven/client`'s
  `LiveStream` API.

## Server SDKs

- **`node-server`** — a real Express server minting RTC tokens with
  `@raven/server`.
- **`python-server`** — the same, with `raven-sdk` and FastAPI.

## RTC + Chat combined

- **`media-demo`** — a minimal static page proving real WebRTC media
  through `@raven/rtc`, backed by a small FastAPI server using
  `raven-sdk`.

## Next

- [RTC → Quickstart](/rtc/quickstart)
- [Chat → Quickstart](/chat/quickstart)
- [Live Streaming → Quickstart](/live-streaming/quickstart)
