---
title: Core concepts
description: Every primitive Livqeno actually has, what it is for, and how it relates to the others.
---

Livqeno has a small vocabulary. Learning it once makes the rest of the
documentation short, because every page assumes these words mean exactly
what this section says they mean.

Nothing here is aspirational — every concept below is a real thing in the
API, with a table behind it or a class in an SDK.

## The shape of it

```
Project                          you create one; everything belongs to it
 ├── Environment                 development · staging · production
 │    └── API key                your backend's credential
 │         └── Token             short-lived, one per client
 ├── Room                        an audio/video session
 │    ├── Participant            one identity in a room
 │    │    └── Track             camera · microphone · screen share
 │    └── Connection             one client's attempt, recorded
 ├── Conversation                a chat channel
 │    ├── Member                 who may read and write
 │    └── Message                durable, ordered, with reactions and threads
 ├── Live stream                 a room + a conversation, with roles
 └── Webhook endpoint            where Livqeno POSTs events
```

## Control plane and media plane

One distinction explains most of the API's shape.

The **control plane** manages records: projects, keys, rooms,
conversations, tokens, webhooks. It is a REST API and it never carries
audio or video.

The **media plane** carries the actual bytes: Livqeno's own SFU, and TURN
relays when a direct path is unavailable. Your client never addresses it.
It connects to a signaling endpoint, and Livqeno allocates a media server on
its behalf.

That separation is why a client only ever holds a token, and why the media
server underneath could be replaced without an SDK release.

## The concepts

| Concept | One line |
|---|---|
| [Project](/concepts/project) | The tenant. Everything belongs to exactly one. |
| [Environment](/concepts/environment) | Development, staging, production — isolated, fixed at three. |
| [API key](/concepts/api-key) | Your backend's permanent credential. Never a client's. |
| [Token](/concepts/token) | A client's short-lived, narrowly scoped credential. |
| [Room](/concepts/room) | Where an audio/video session happens. |
| [Participant](/concepts/participant) | One identity in one room. |
| [Track](/concepts/track) | One stream of media a participant publishes. |
| [Connection](/concepts/connection) | The record of one client's session, for debugging. |
| [Conversation](/concepts/conversation) | A chat channel with durable history. |
| [Message](/concepts/message) | One durable, ordered entry in a conversation. |
| [Live stream](/concepts/live-stream) | A room and a conversation, with host/viewer roles. |
| [Event](/concepts/event) | Something that happened — as an SDK callback or a webhook. |
| [Webhook](/concepts/webhook) | A signed HTTP POST to your backend when an event fires. |

## What Livqeno does not have

Stated because their absence shapes designs:

- **No recording.** Nothing captures a room or stream to storage.
- **No usage metering or billing.**
- **No user accounts for *your* users.** Livqeno has no idea who your users
  are; identity arrives as a string your backend chose when it minted a
  token.
- **No "channel" primitive distinct from a conversation.** `CHANNEL` is one
  of three [conversation types](/concepts/conversation).

## Next steps

- [Quickstart](/getting-started/quickstart) — put the vocabulary to work.
- [Architecture](/getting-started/architecture) — how the planes fit together.
