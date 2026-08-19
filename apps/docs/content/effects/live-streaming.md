---
title: Live Streaming Integration
description: The same Effects pipeline, applied to a stream host's camera — viewers never need the Effects SDK.
---

A live stream's camera is an ordinary [`@corvidhq/rtc` `Room`](/rtc)
underneath — `stream.room` — so effects attach exactly the way they do
for a plain RTC call. Nothing effects-specific was built into Live
Streaming to make this work.

```
Host
 ↓
Camera
 ↓
Effects
 ↓
Raven RTC
 ↓
Live Stream
 ↓
Viewers
```

## Host-side setup

<Tabs>
<Tab title="Web">

```ts
import { LiveStream } from '@corvidhq/client';
import { effects } from '@corvidhq/effects';

const stream = await LiveStream.join(credentials); // role: 'HOST' or 'CO_HOST'
const camera = await stream.room.enableCamera();

const pipeline = effects.createPipeline();
pipeline.applyPreset(effects.presets.vivid);

await camera.attachEffects(pipeline);
```

</Tab>
<Tab title="React">

```tsx
'use client';
import { RavenLiveStream, useCamera, useCameraEffects, effectPresets } from '@corvidhq/react';

function HostView() {
  const camera = useCamera();
  const effects = useCameraEffects();

  return (
    <button onClick={() => effects.applyPreset(effectPresets.vivid)}>Apply Vivid</button>
  );
}

<RavenLiveStream credentials={credentials}>
  <HostView />
</RavenLiveStream>;
```

`useCameraEffects()` works unchanged inside `<RavenLiveStream>` — it
reads the same `Room` the live stream already established, exactly like
`useCamera()`/`useParticipants()` do.

</Tab>
</Tabs>

## Viewers receive processed video automatically

A viewer subscribes to the host's track through the ordinary
`trackSubscribed` event, same as any RTC participant — see
[Rooms & Participants](/rtc/rooms-and-participants). Because effects
process the track *before* publish, the SFU forwards the already-filtered
video: a viewer's `RemoteTrack` is indistinguishable from an unfiltered
one, and viewers never install or import `@corvidhq/effects`.

## What isn't affected

- **Live chat and reactions** keep working — they're a separate
  `ChatClient` composed alongside the same `Room`; effects touch video
  only. See [Live Chat](/live-streaming/live-chat).
- **Ending the stream / leaving** — `stream.leave()` behaves exactly as
  documented in [Streams & Lifecycle](/live-streaming/streams), whether
  or not a pipeline is attached.
- **Co-hosts** each attach their own pipeline to their own camera
  independently — one host's filter choice never affects another's video.

## Related

- [RTC Integration](/effects/rtc-integration) — the underlying mechanism.
- [Live Streaming → Filters & Effects](/live-streaming/filters) — the product-facing summary of this page.
