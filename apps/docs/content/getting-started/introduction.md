---
title: Introduction
description: What Livqeno is, what it isn't, and where to go next.
---

Livqeno is developer-first real-time infrastructure. It gives your
product audio and video calling, and real-time chat, without you
operating WebRTC signaling, media servers, or a message broker yourself.

Concretely, Livqeno owns:

- **Projects, environments, and API keys** — the control plane every
  other piece is scoped by.
- **Short-lived tokens** — what your backend hands a client so it can
  join a call or a conversation, without ever exposing your API key.
- **RTC** — audio and video sessions on Livqeno's own SFU, with signaling,
  TURN, and reconnection handled.
- **Chat** — conversations, messages, presence, typing, receipts,
  reactions, and threads, as a first-class service, not a bolt-on.
- **Live streaming** — one host and many subscribe-only viewers, with a
  real chat conversation attached on join.
- **Effects** — a camera filter and preset pipeline that runs entirely
  client-side and needs no Livqeno credential at all.
- **Webhooks and events** — so your backend can react to what happens
  in a call, a conversation, or a stream.

## What Livqeno is not

Livqeno is infrastructure, not a finished video-calling app. You still
build the UI — the call screen, the chat panel, the "who's online"
indicator. Livqeno's SDKs give you the primitives (`room.enableCamera()`,
`chat.sendMessage()`) rather than a drop-in widget.

It's also not a wrapper around someone else's API. The control plane —
auth, projects, tokens, permissions, webhooks — is Livqeno's own, so you
get one consistent model whether you're building the calling side, the
chat side, or both. See [Architecture](/getting-started/architecture)
for how the pieces fit together.

## Where to go next

- New to Livqeno? Start with the [Quickstart](/getting-started/quickstart)
  — a project, a token, and your first call or message in a few minutes.
- Building calling? [RTC → Overview](/rtc).
- Building chat? [Chat → Overview](/chat).
- Wiring up your backend? [Access tokens](/authentication/tokens) and the
  [REST API](/api).
- Want the vocabulary first? [Core concepts](/concepts).
- Running this yourself? [Production → Security](/production/security)
  and [Production → Environments](/production/environments).

## Running it yourself

Livqeno is open source, and self-hosting is a first-class path rather than an
afterthought. `docker compose up` brings up everything except Postgres,
which is deliberately yours to point at. See
[Self-hosting](/self-hosting).

## What Livqeno does not do

Stated up front because it changes designs: there is **no recording**, no
RTMP ingest or egress, and no billing — every account gets three
independent fixed grants (10,000 RTC participant-minutes, 100,000 Chat
messages, 100 Live Streaming host-hours — [Usage](/concepts/usage)) and
there is no plan to upgrade to when one of them is gone. The full list is
in [Known limitations](/reference/known-limitations).
