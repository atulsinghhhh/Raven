---
title: Filters & Effects
description: Not built yet — this page documents the extension boundary the Web SDK's media pipeline was deliberately designed to leave open.
---

Raven Live Streaming does not have a filters or effects pipeline yet —
no background blur, no AR, no Snapchat-style overlays. This page exists
because it's a frequently asked "does Raven do X" question, not because
there's a feature to document.

## What exists today

`stream.room` is an ordinary [`@raven/rtc` `Room`](/rtc) —
`enableCamera()`/`enableMicrophone()` publish the raw device track,
unmodified. Nothing in the current Web SDK intercepts or transforms a
track between capture and publish.

## Why this is called out explicitly

The media path was deliberately left untouched in this phase — no
canvas-based frame pipeline, no WebGL hook, no dependency pulled in for
a feature that doesn't exist — specifically so that adding a real
effects pipeline later doesn't have to unwind a half-built one first.
There is currently no committed design for what that extension point
will look like.

## If you need this today

You'd need to build your own capture → transform → republish pipeline
(e.g. a `canvas`/`WebGL` step between `getUserMedia` and whatever
publishes the resulting `MediaStreamTrack`) and publish the transformed
track yourself. Raven doesn't currently expose a lower-level "publish
this track I already have" primitive distinct from
`enableCamera()`/`enableMicrophone()` — check
[Rooms & Participants](/rtc/rooms-and-participants) for the most
current state of the local-track API before attempting this.

## Next

- [Live Chat](/live-streaming/live-chat)
- [Overview](/live-streaming) — known limitations for this phase
