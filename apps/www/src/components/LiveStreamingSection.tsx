'use client';

import { CodeBlock } from './CodeBlock';
import { useInView } from '../lib/useInView';
import { useCountUp } from '../lib/useCountUp';

const CODE = `import { LiveStream } from '@corvidhq/client';

const stream = await LiveStream.join({
  streamId,
  role: 'HOST',
  rtc: credentials.rtc,
  chat: credentials.chat,
});

await stream.room.enableCamera();
await stream.room.enableMicrophone();

// A Raven Chat conversation comes attached automatically.
await stream.react('🔥');`;

const CHAT_LINES = [
  { from: 'Alice', text: 'Amazing stream!' },
  { from: 'Bob', text: '🔥🔥🔥' },
];

const REACTIONS = [
  { emoji: '❤️', target: 128 },
  { emoji: '👏', target: 84 },
  { emoji: '🔥', target: 52 },
];

/**
 * Live Streaming's half of the "Products" trio. Every number here is a
 * scripted demo animation, not live data — labeled as a preview, same
 * as the dashboard mockup below it.
 */
export function LiveStreamingSection() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const viewers = useCountUp(inView ? 342 : 0, inView);

  return (
    <section className="border-t border-line bg-surface-sunken/40 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2 md:items-center">
        <div>
          <span className="text-sm font-semibold text-accent-text">Live Streaming</span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-fg md:text-4xl">
            Turn any product into a live experience.
          </h2>
          <p className="mt-4 text-muted">
            A host publishes, viewers watch, co-hosts join in — with a Raven Chat conversation attached
            automatically for live comments and reactions. Same rooms and tokens as RTC, one join call.
          </p>
          <div className="mt-6">
            <CodeBlock filename="live.js" code={CODE} />
          </div>
        </div>

        <div ref={ref} className="overflow-hidden rounded-xl border border-line bg-surface shadow-raven-lg">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-xs font-semibold text-accent-fg">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-fg animate-pulse-dot" />
              LIVE
            </span>
            <span className="tabular text-xs font-medium text-muted">{viewers.toLocaleString()} watching</span>
          </div>

          <div className="flex h-40 items-center justify-center bg-surface-sunken">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-subtle text-lg font-semibold text-accent-text">
              A
            </span>
          </div>

          <div className="flex items-center gap-4 border-b border-line px-5 py-3">
            {REACTIONS.map((r) => (
              <ReactionCount key={r.emoji} emoji={r.emoji} target={r.target} active={inView} />
            ))}
          </div>

          <ul className="flex flex-col gap-2 px-5 py-4">
            {CHAT_LINES.map((line, i) => (
              <li
                key={i}
                className="text-sm text-fg transition-all duration-500"
                style={{
                  opacity: inView ? 1 : 0,
                  transform: inView ? 'none' : 'translateY(6px)',
                  transitionDelay: `${300 + i * 200}ms`,
                }}
              >
                <span className="font-medium text-muted">{line.from}: </span>
                {line.text}
              </li>
            ))}
          </ul>

          <p className="border-t border-line px-5 py-2.5 text-[11px] text-subtle">
            Preview — scripted demo, not live data.
          </p>
        </div>
      </div>
    </section>
  );
}

function ReactionCount({ emoji, target, active }: { emoji: string; target: number; active: boolean }) {
  const value = useCountUp(target, active);
  return (
    <span className="tabular inline-flex items-center gap-1.5 text-sm text-muted">
      <span aria-hidden="true">{emoji}</span>
      {value}
    </span>
  );
}
