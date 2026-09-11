---
title: Streams & Lifecycle
description: CREATED → LIVE → ENDED — a stream's status only ever moves forward.
---

<Tabs>
<Tab title="Node.js">

```ts
const stream = await raven.liveStreams.create({ title: 'Launch Day', hostIdentity: 'alice' });
```

</Tab>
<Tab title="Python">

```python
stream = raven.live_streams.create(CreateLiveStreamParams(title="Launch Day", host_identity="alice"))
```

</Tab>
<Tab title="CLI">

```bash
raven streams create "Launch Day" --host alice
```

</Tab>
<Tab title="cURL">

```bash
curl -X POST "$RAVEN_API_URL/v1/live-streams" \
  -H "Authorization: Bearer $RAVEN_API_KEY" \
  -d '{"title": "Launch Day", "hostIdentity": "alice"}'
```

</Tab>
</Tabs>

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

<Tabs>
<Tab title="Node.js">

```ts
await raven.liveStreams.start(streamId);
await raven.liveStreams.end(streamId);
```

</Tab>
<Tab title="Python">

```python
raven.live_streams.start(stream_id)
raven.live_streams.end(stream_id)
```

</Tab>
<Tab title="CLI">

```bash
raven streams end <streamId>
```

There's no `raven streams start` — a stream typically goes live from
your own application's client SDK when the host actually starts
publishing, not by clicking a button in the dashboard/CLI.

</Tab>
<Tab title="cURL">

```bash
curl -X POST "$RAVEN_API_URL/v1/live-streams/$STREAM_ID/start" \
  -H "Authorization: Bearer $RAVEN_API_KEY"

curl -X POST "$RAVEN_API_URL/v1/live-streams/$STREAM_ID/end" \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

</Tab>
</Tabs>

`ENDED` is terminal — there is no restart or replay path yet. Any other
transition (starting twice, ending an already-ended stream, ending one
that was never started) is rejected rather than silently accepted.

## Reading a stream

<Tabs>
<Tab title="Node.js">

```ts
const stream = await raven.liveStreams.get(streamId);
const all = await raven.liveStreams.list({ status: 'LIVE' }); // no live viewer counts — one GET per stream for that
```

</Tab>
<Tab title="Python">

```python
stream = raven.live_streams.get(stream_id)
live_streams = raven.live_streams.list(status="LIVE")
```

</Tab>
<Tab title="CLI">

```bash
raven streams list --status LIVE
raven streams inspect <streamId>
```

</Tab>
<Tab title="cURL">

```bash
curl "$RAVEN_API_URL/v1/live-streams/$STREAM_ID" \
  -H "Authorization: Bearer $RAVEN_API_KEY"
```

</Tab>
</Tabs>

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

## Updating a stream

Title, description, category, tags, language, visibility, and metadata
— never status; use `start()`/`end()` for that.

<Tabs>
<Tab title="Node.js">

```ts
await raven.liveStreams.update(streamId, { title: 'Launch Day (Part 2)' });
```

</Tab>
<Tab title="Python">

```python
from raven import UpdateLiveStreamParams

raven.live_streams.update(stream_id, UpdateLiveStreamParams(title="Launch Day (Part 2)"))
```

</Tab>
<Tab title="CLI">

```bash
raven streams update <streamId> --title "Launch Day (Part 2)"
```

</Tab>
</Tabs>

Fails with a conflict once the stream has `ENDED` — an ended stream is
immutable.

## Common errors

| Error | Why | Fix |
|---|---|---|
| `RAVEN_STREAM_NOT_FOUND` | Wrong id, or a different project/environment. | Confirm the id came from `create()`/`list()`, not a guess. |
| `RAVEN_STREAM_INVALID_STATE` | An invalid lifecycle transition, or updating an `ENDED` stream. | Check `status` first — every transition only moves forward. |

## Production notes

- Poll `get()` for a live viewer count only as often as your UI actually
  needs it — each call does one SFU round trip.
- `list()` deliberately omits live viewer counts (`viewerCount: null`)
  to avoid one SFU round trip per row — fetch a stream individually if
  you need its live count.

## Next

- [Hosts & Co-hosts](/live-streaming/hosts)
- [Viewers](/live-streaming/viewers)
