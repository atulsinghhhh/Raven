---
title: Live Streaming Overview
description: One host, any number of viewers, and a real chat conversation attached automatically — built entirely on Raven RTC and Raven Chat.
---

Raven Live Streaming is not a third real-time system bolted onto RTC and
Chat — it's the two of them, composed. A live stream is one RTC `Room`
(the host and any co-hosts are just participants with publish
permission) plus one Chat `Conversation` (created and attached
automatically), with lifecycle and role bookkeeping layered on top. You
don't run a separate media server, a separate chat backend, or stitch
the two together yourself.

## Why this matters

A typical live-streaming build asks you to run an SFU, a chat service,
and a bridge between the two — three systems, three sets of
credentials, three failure modes. On Raven, `POST /v1/live-streams`
gives you both a room and a conversation in one call, and a viewer's
chat message rides the same infrastructure `@corvidhq/chat` already
documents.

| | RTC | Chat | Live Streaming |
|---|---|---|---|
| Primitive | `Room` | `Conversation` | `LiveStream` (wraps one of each) |
| Who can publish | anyone with `publish: true` | — | only hosts/co-hosts — never viewers |
| Credential | RTC token | chat token | both, minted together per role |

## Lifecycle

```
CREATED → STARTING → LIVE → ENDING → ENDED
```

In the current implementation, `start()` moves `CREATED → LIVE`
directly — there's no asynchronous provisioning step that would need a
visible `STARTING` phase, so the state is skipped rather than
paused-on. `end()` moves `LIVE → ENDED` and closes the underlying room.
`ENDED` is terminal: there is no restart or replay path in this phase.
Every other transition is rejected with `RAVEN_STREAM_INVALID_STATE`.

## Roles

- **Host** — created the stream (or was added with the `HOST` role).
  Can publish audio/video, invite/remove co-hosts, and moderates chat
  with `ADMIN` scope.
- **Co-host** — added by a host. Can publish audio/video and moderates
  chat with `MODERATOR` scope.
- **Viewer** — anyone else. Subscribe-only, always: a viewer's RTC token
  has `publish: false` baked in server-side, and the viewer-token
  request has no role field to override it. Chats with `MEMBER` scope.

Raven's own `ProjectMember`/RBAC model is unrelated to any of this — it
controls who on *your team* can manage the Raven project itself. Hosts
and viewers are your application's end users, authenticated however
your backend already authenticates them, and are never granted
dashboard access.

## Chat and reactions

Every stream gets a `Conversation` the moment it's created, plus a
hidden system root message. Regular chat (`stream.chat.sendMessage`)
works exactly as documented in [Chat](/chat). Reactions
(`stream.react('❤️')`) add a `Reaction` to that root message — there's
no second, live-streaming-specific realtime primitive; it's the same
aggregation `Reactions` already provides for ordinary messages.

## Webhooks

`live_stream.created`, `.started`, `.ended`, `.host_joined`,
`.host_left`, `.viewer_joined`, `.viewer_left` — signed and delivered
exactly like every other Raven webhook. See [Webhooks](/webhooks).

## Known limitations (this phase)

- No cloud recording, AI moderation/captions, or media effects/filters
  pipeline yet — see [Filters & Effects](/live-streaming/filters) for
  the extension boundary the SDK leaves open for this.
- Viewer count is derived live from the SFU's current participants, not
  stored — see [Analytics](/live-streaming/analytics) for exactly
  what's tracked.
- No dashboard/CLI path to mint host or viewer credentials — by design;
  see [SDK Support Matrix](/live-streaming/sdk-support#cli).
- Flutter's `raven_live` package hasn't run against a real Flutter
  toolchain in this repo yet (no Flutter/Dart available in the build
  environment that wrote it) — the credential-parsing logic has unit
  tests, but `RavenLiveStream.join()`/`leave()`/`react()` haven't been
  exercised end-to-end. Treat it as unverified until a Flutter CI job
  covers it.

## Next

- [Quickstart](/live-streaming/quickstart)
- [Streams & Lifecycle](/live-streaming/streams)
- [Hosts & Co-hosts](/live-streaming/hosts) and [Viewers](/live-streaming/viewers)
- [Live Chat](/live-streaming/live-chat) and [Reactions](/live-streaming/reactions)
- [SDK Support Matrix](/live-streaming/sdk-support) — what every SDK implements, and what's deliberately absent

Interactive hosts and co-hosts run on [Raven RTC](/rtc); comments and
reactions run on [Raven Chat](/chat) — Live Streaming is what connects
the two into one product surface, not a replacement for either.
