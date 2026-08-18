---
title: Event Catalogue
description: What Raven actually emits today, delivered through the webhook pipeline.
---

Every event below is delivered the same way — see
[Webhooks](/server/webhooks) for the envelope, signing, and retry
behavior.

## Chat

| Event | Fires when |
|---|---|
| `message.created` | A message is stored |
| `message.updated` | A message is edited |
| `message.deleted` | A message is soft-deleted |
| `reaction.added` | A reaction is added |
| `reaction.removed` | A reaction is removed |
| `room.created` | A conversation is created |
| `participant.joined` | A member joins a conversation |
| `participant.left` | A member leaves a conversation |

That's the complete current catalogue. Chat is the only event producer
today — the pipeline is project-scoped rather than chat-specific so that
future sources (RTC room lifecycle, membership changes, project
settings) publish through this same mechanism rather than a second one.
Subscribe to specific events, or leave the list empty to receive
everything currently emitted; a future addition to this list is
additive, and an existing subscription with an empty filter picks it up
automatically.

## What isn't emitted yet

Stated plainly rather than left to guesswork: RTC room lifecycle
(`room.started`/`room.ended`), track events, connection state changes,
conversation/member management events beyond what's listed above, and
presence events are not currently delivered as webhooks. If your
integration needs one of these, the equivalent data is generally
available by polling the relevant REST endpoint — see
[REST API](/server/rest-api) — or, for RTC connection data specifically,
via [Diagnostics](/rtc/diagnostics).
