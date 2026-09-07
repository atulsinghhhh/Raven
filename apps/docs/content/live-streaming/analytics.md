---
title: Analytics
description: What's actually tracked today — a live viewer count and a peak — and what isn't, stated plainly rather than left to guesswork.
---

Live Streaming does not have an analytics dashboard or historical
viewer-metrics store yet. What exists today is two fields on the stream
itself, read the same way regardless of SDK:

<Tabs>
<Tab title="Node.js">

```ts
const stream = await raven.liveStreams.get(streamId);
console.log(stream.viewerCount, stream.peakViewerCount);
```

</Tab>
<Tab title="Python">

```python
stream = raven.live_streams.get(stream_id)
print(stream["viewerCount"], stream["peakViewerCount"])
```

</Tab>
<Tab title="CLI">

```bash
raven streams inspect <streamId>
```

</Tab>
<Tab title="Dashboard">

The [Live Streaming dashboard](/live-streaming) — Overview and a
stream's own detail page — reads these same two fields; it never
fabricates a number the API didn't return.

</Tab>
</Tabs>

```json
{
  "viewerCount": 12,
  "peakViewerCount": 47
}
```

- **`viewerCount`** — derived live from the SFU's current participants
  each time the stream is read; it is not stored, so there's no
  point-in-time history to query. Expect a brief lag between a
  viewer's connection actually dropping and this number reflecting it.
- **`peakViewerCount`** — the highest `viewerCount` observed so far
  during this stream's `LIVE` period, updated opportunistically as the
  stream is read. It only ever increases, and resets on the next
  stream (it's per-stream, not per-host or per-project).

## What isn't built

No historical/time-series viewer graph, no watch-time, no
geography/device breakdown, no per-viewer session log. If you need any
of this today, you'd need to poll `GET /v1/live-streams/:id` yourself
and store the samples — Raven isn't doing that recording for you yet.

## Structured logging, not analytics

Stream lifecycle events (`created`, `started`, `ended`, host/viewer
join/leave) are available as [webhooks](/live-streaming#webhooks), which
you can log or forward yourself — see
[Webhooks](/webhooks) for the delivery guarantees.

## Next

- [Streams & Lifecycle](/live-streaming/streams)
