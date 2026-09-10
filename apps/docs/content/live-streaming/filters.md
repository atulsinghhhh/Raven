---
title: Filters & Effects
description: Livqeno Effects, applied to a live stream host's camera — the same pipeline used on any RTC call, with no viewer-side dependency.
---

Livqeno Live Streaming has a filters and effects pipeline as of Livqeno
Effects (`@ravenkash/effects`) — no separate implementation was built for
Live Streaming, because `stream.room` is an ordinary
[`@ravenkash/rtc` `Room`](/rtc) and effects attach the same way they do on
any call.

```ts
import { LiveStream } from '@ravenkash/client';
import { effects } from '@ravenkash/effects';

const stream = await LiveStream.join(credentials);
const camera = await stream.room.enableCamera();

const pipeline = effects.createPipeline();
pipeline.applyPreset(effects.presets.vivid);

await camera.attachEffects(pipeline);
```

Viewers receive the already-processed video through the ordinary
`trackSubscribed` event — they never install `@ravenkash/effects` or know
a filter is applied.

See the full [Effects → Live Streaming Integration](/effects/live-streaming)
page for host-side React usage, co-hosts, and what stays unaffected
(chat, reactions, stream lifecycle).

## What's not here yet

Background blur/replacement and AR overlays/masks are not implemented —
see [Effects → API Reference](/effects/api-reference#background-blurreplacement-planned)
for the real status of each. React Native and Flutter hosts can build
and validate a pipeline today but don't yet have a native engine to run
it against a live camera — see
[Effects → React Native](/effects/react-native) and
[Effects → Flutter](/effects/flutter).

## Next

- [Effects Overview](/effects)
- [Live Chat](/live-streaming/live-chat)
- [Overview](/live-streaming) — known limitations for this phase
