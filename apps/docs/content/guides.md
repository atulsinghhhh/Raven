---
title: Guides
description: End-to-end builds. Each one starts from an empty folder and finishes with something that runs.
---

Reference pages tell you what an API does. These tell you how to put one
together.

Every guide follows the same shape: what we're building, prerequisites,
implementation, how it works, production considerations, next steps. Read
the "how it works" section — that is where the design decisions are, and
they are the part that transfers to your own app.

## Calls

| Guide | Build time | You end with |
|---|---|---|
| [Build a video call](/guides/build-a-video-call) | ~20 min | Two participants, camera and microphone |
| [Build a group call](/guides/build-a-group-call) | ~30 min | A participant grid that scales to a room |
| [Add screen sharing](/guides/add-screen-sharing) | ~10 min | A screen share track alongside the camera |
| [Handle reconnection](/guides/handle-reconnection) | ~15 min | A UI that survives a network drop |

## Chat and streaming

| Guide | Build time | You end with |
|---|---|---|
| [Build a chat application](/guides/build-a-chat-application) | ~25 min | Durable history, presence, typing |
| [Build a live stream](/guides/build-a-live-stream) | ~30 min | One host, many viewers, live chat |

## Backend

| Guide | Build time | You end with |
|---|---|---|
| [Handle webhooks](/guides/handle-webhooks) | ~20 min | A verified, idempotent receiver |
| [Build for production](/guides/build-for-production) | ~45 min | A deployment that will survive contact with users |

## Migrating

| Guide | You end with |
|---|---|
| [Migrate from LiveKit](/guides/migrate-from-livekit) | A mapping from LiveKit's concepts to Raven's |

## Before you start any of them

You need a project, an API key, and somewhere to run a small backend. If you
do not have those, spend five minutes on the
[Quickstart](/getting-started/quickstart) first — every guide assumes it.

## Next steps

- [Examples](/examples) — the same ideas as runnable apps in the repository.
- [Concepts](/concepts) — the vocabulary the guides use.
