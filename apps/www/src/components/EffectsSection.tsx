'use client';

import { CodeBlock } from './CodeBlock';
import { useInView } from '../lib/useInView';

// Real preset names from packages/effects/src/presets.ts — nothing here
// is invented, and each is a pure composition of the filters below it,
// not a separate implementation.
const PRESETS = ['vivid', 'warm', 'cool', 'cinematic', 'vintage'] as const;

const CODE = `import { effects } from '@corvidhq/effects';

const pipeline = effects.createPipeline();
pipeline.add(effects.filters.brightness({ value: 0.2 }));
pipeline.add(effects.filters.saturation({ value: 1.2 }));

const camera = await room.enableCamera();
await camera.attachEffects(pipeline);`;

/** Effects' half of the products lineup — a preset rail, not a rendered filter preview. */
export function EffectsSection() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="border-t border-line bg-surface-sunken/40 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2 md:items-center">
        <div>
          <span className="mono-label text-[12px] text-accent-text">Effects</span>
          <h2 className="mt-2 text-3xl font-light tracking-tight text-fg md:text-4xl">
            Filters on the track, before it ever leaves the device.
          </h2>
          <p className="mt-4 text-muted">
            <code className="rounded-(--radius-panel) bg-surface-raised px-1.5 py-0.5 font-mono text-sm text-fg">
              camera.attachEffects()
            </code>{' '}
            swaps the published track in place — no reconnect, no renegotiation. Runs entirely inside the SDK,
            shared by RTC and Live Streaming.
          </p>
          <div className="mt-6">
            <CodeBlock filename="effects.js" code={CODE} />
          </div>
        </div>

        <div ref={ref} className="rounded-(--radius-panel) border border-line bg-surface p-6">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <span className="font-mono text-sm text-muted">Camera preview</span>
            <span className="mono-label rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">
              Client-side
            </span>
          </div>

          <div className="mt-5 flex h-32 items-center justify-center rounded-(--radius-panel) border border-line bg-surface-sunken">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-subtle text-sm font-medium text-accent-text">
              A
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((preset, i) => (
              <span
                key={preset}
                className={`mono-label rounded-full border px-3 py-1.5 text-[11px] transition-all duration-500 ${
                  preset === 'cinematic' ? 'border-accent-line bg-accent-subtle text-accent-text' : 'border-line text-muted'
                }`}
                style={{
                  opacity: inView ? 1 : 0,
                  transform: inView ? 'none' : 'translateY(4px)',
                  transitionDelay: `${i * 80}ms`,
                }}
              >
                {preset}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
