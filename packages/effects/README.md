# @ravenkash/effects

Raven's real-time video effects pipeline — filters, presets, beauty
smoothing, background processing and face detection.

**Provider-agnostic**: takes a `MediaStreamTrack`, returns a processed
`MediaStreamTrack`. Nothing in it is specific to Raven, so it works with
any WebRTC stack.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Install

```bash
npm install @ravenkash/effects
```

Already a dependency of `@ravenkash/rtc`, so you only need this directly if
you want the pipeline on its own.

## Use

```ts
import { createEffectsPipeline, filters, presets } from '@ravenkash/effects';

const pipeline = createEffectsPipeline();

pipeline.add(filters.saturation({ value: 0.4 }));
pipeline.add(filters.contrast({ value: 0.1 }));

const processed = pipeline.process(cameraTrack);
```

Presets are ordered filter stacks — `presets.vintage()`, and friends.

## Exports

`createEffectsPipeline`, `EffectsPipeline`, `filters`,
`FILTER_DEFINITIONS`, `presets`, `beauty`, `createFaceDetector`,
`createBackgroundProcessor`, `EFFECT_SECURITY_LIMITS`.

## Documentation

- [Effects reference](https://github.com/atulsinghhhh/Raven/blob/main/apps/docs/content/effects.md)
- Runnable example: [`examples/effects-demo`](https://github.com/atulsinghhhh/Raven/tree/main/examples/effects-demo)

With React, prefer the `useCameraEffects` hook from
[`@ravenkash/react`](https://www.npmjs.com/package/@ravenkash/react).

## License

MIT
