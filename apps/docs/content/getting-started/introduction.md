---
title: Introduction
description: What Raven is, what it isn't, and where to go next.
---

Raven is developer-first real-time infrastructure. It gives your
product audio and video calling, and real-time chat, without you
operating WebRTC signaling, media servers, or a message broker yourself.

Concretely, Raven owns:

- **Projects, environments, and API keys** — the control plane every
  other piece is scoped by.
- **Short-lived tokens** — what your backend hands a client so it can
  join a call or a conversation, without ever exposing your API key.
- **Rooms and calls** — audio/video sessions, run on Raven's managed
  RTC infrastructure.
- **Chat** — conversations, messages, presence, typing, receipts,
  reactions, and threads, as a first-class service, not a bolt-on.
- **Webhooks and events** — so your backend can react to what happens
  in a call or a conversation.

## What Raven is not

Raven is infrastructure, not a finished video-calling app. You still
build the UI — the call screen, the chat panel, the "who's online"
indicator. Raven's SDKs give you the primitives (`room.enableCamera()`,
`chat.sendMessage()`) rather than a drop-in widget.

It's also not a wrapper around someone else's API. The control plane —
auth, projects, tokens, permissions, webhooks — is Raven's own, so you
get one consistent model whether you're building the calling side, the
chat side, or both. See [Architecture](/getting-started/architecture)
for how the pieces fit together.

## Where to go next

- New to Raven? Start with the [Quickstart](/getting-started/quickstart)
  — a project, a token, and your first call or message in a few minutes.
- Building calling? [RTC → Overview](/rtc).
- Building chat? [Chat → Overview](/chat).
- Wiring up your backend? [Server → Tokens](/authentication/tokens) and
  [Server → REST API](/api-reference).
- Running this yourself? [Production → Security](/production/security)
  and [Production → Environments](/production/environments).

## Local development

`docker compose up` brings up everything Raven's control plane needs —
datastores, the RTC media server, and TURN — for working against a local
copy while you build. See
[Installing from source](/getting-started/installing-from-source).
