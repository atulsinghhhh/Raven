---
title: Streams & Lifecycle
description: CREATED → LIVE → ENDED — a stream's status only ever moves forward.
---

```bash
curl -X POST https://api.raven.dev/v1/live-streams \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"title": "Launch Day", "hostIdentity": "alice"}'
```

Creating a stream does three things in one call: creates the
underlying RTC room, creates and attaches a Chat conversation (see
[Live Chat](/live-streaming/live-chat)), and registers the creator as
its first host.

## Lifecycle

```
CREATED → STARTING → LIVE → ENDING → ENDED
```

In the current implementation, `start` moves `CREATED` straight to
`LIVE` — there's no asynchronous provisioning step that needs a visible
`STARTING` phase, so it's skipped rather than paused on. `end` moves
`LIVE` straight to `ENDED` and closes the underlying room.

```bash
curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/start \
  -H "Authorization: Bearer $RAVEN_API_KEY"

curl -X POST https://api.raven.dev/v1/live-streams/$STREAM_ID/end \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

`ENDED` is terminal — there is no restart or replay path yet. Any other
transition (starting twice, ending an already-ended stream, ending one
that was never started) is rejected rather than silently accepted.

## Reading a stream

```bash
curl https://api.raven.dev/v1/live-streams/$STREAM_ID \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

```json
{
  "id": "stream_jRoD1T3EXh0PMJRGG4zYzQ",
  "status": "LIVE",
  "conversationId": "conv_0iojWXJCtXZUUkDR7THBmQ",
  "chatRootMessageId": "msg_Efm2zArYJTSRUr88BV5bZg",
  "hosts": [{ "identity": "alice", "role": "HOST" }],
  "viewerCount": 12,
  "peakViewerCount": 47,
  "startedAt": "2026-08-19T08:21:13.792Z",
  "endedAt": null
}
```

`viewerCount` is derived live from the SFU's current participants, not
stored — see [Analytics](/live-streaming/analytics) for what is and
isn't tracked historically.

## Next

- [Hosts & Co-hosts](/live-streaming/hosts)
- [Viewers](/live-streaming/viewers)
