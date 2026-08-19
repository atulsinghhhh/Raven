'use client';

import { CodeBlock } from './CodeBlock';
import { useInView } from '../lib/useInView';

const PARTICIPANTS = ['Alice', 'Bob', 'Charlie'];

const CODE = `import { createRTCClient } from '@corvidhq/rtc';

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.endpoint,
  iceServers: resp.iceServers,
});

const room = await client.join('demo-room');
await room.enableCamera();
await room.enableMicrophone();`;

/** RTC's half of the "Products" trio — a simulated room, not a screen recording. */
export function RTCSection() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="border-t border-line bg-surface-sunken/40 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2 md:items-center">
        <div>
          <span className="text-sm font-semibold text-accent-text">RTC</span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-fg md:text-4xl">
            Video calls without the infrastructure headache.
          </h2>
          <p className="mt-4 text-muted">
            Rooms, participants, and reconnection handled underneath — your app calls{' '}
            <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-sm text-fg">join()</code> and gets
            back a room with cameras, microphones, and screen shares already wired for network blips.
          </p>
          <div className="mt-6">
            <CodeBlock filename="client.js" code={CODE} />
          </div>
        </div>

        <div ref={ref} className="rounded-xl border border-line bg-surface p-6 shadow-raven-lg">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <span className="font-mono text-sm text-muted">Raven Room · demo-room</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success-line bg-success-subtle px-2.5 py-1 text-xs font-medium text-success-text">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
              Connected
            </span>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {PARTICIPANTS.map((name, i) => (
              <div
                key={name}
                className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface-raised p-4 transition-all duration-500"
                style={{
                  opacity: inView ? 1 : 0,
                  transform: inView ? 'none' : 'translateY(8px)',
                  transitionDelay: `${i * 150}ms`,
                }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle text-sm font-semibold text-accent-text">
                  {name[0]}
                </span>
                <span className="text-xs font-medium text-fg">{name}</span>
                <AudioBars active={i === 0} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .raven-audio-bar { animation: raven-audio-level 0.9s ease-in-out infinite; }
        .raven-audio-bar:nth-child(2) { animation-delay: 0.15s; }
        .raven-audio-bar:nth-child(3) { animation-delay: 0.3s; }
        @keyframes raven-audio-level {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </section>
  );
}

function AudioBars({ active }: { active: boolean }) {
  return (
    <div className="flex h-3 items-end gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`raven-audio-bar w-1 origin-bottom rounded-full ${active ? 'bg-success' : 'bg-line-strong'}`}
          style={{ height: '100%', animationPlayState: active ? 'running' : 'paused' }}
        />
      ))}
    </div>
  );
}
