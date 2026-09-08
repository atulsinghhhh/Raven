'use client';

import { useCountUp } from '../lib/useCountUp';

/**
 * The four product visuals, extracted from what used to be four
 * standalone marketing sections so they can be swapped inside the
 * product tab strip and re-used as the code editor's preview pane.
 *
 * All four are scripted illustrations: no live data, no screen
 * recordings. Because they now mount on tab selection rather than
 * scroll into view, the entrance is a CSS fade on mount instead of an
 * IntersectionObserver stagger.
 */

const PARTICIPANTS = ['Alice', 'Bob', 'Charlie'];

/** RTC: a room with three participants, one of them speaking. */
export function RoomDemo() {
  return (
    <DemoPanel title="Raven Room · demo-room">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="font-mono text-xs text-muted">3 participants</span>
        <span className="mono-label inline-flex items-center gap-1.5 rounded-(--radius-panel) border border-success-line bg-success-subtle px-2 py-1 text-[10px] text-success-text">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
          Connected
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 p-5">
        {PARTICIPANTS.map((name, i) => (
          <div
            key={name}
            className="animate-fade-in flex flex-col items-center gap-2 rounded-(--radius-panel) border border-line bg-surface-raised p-4"
            style={{ animationDelay: `${i * 90}ms`, animationFillMode: 'backwards' }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle text-sm font-semibold text-accent-text">
              {name[0]}
            </span>
            <span className="text-xs font-medium text-fg">{name}</span>
            <AudioBars active={i === 0} />
          </div>
        ))}
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
    </DemoPanel>
  );
}

const MESSAGES = [
  { from: 'Alice', text: 'Are we still shipping today?', receipt: 'read' as const },
  { from: 'Bob', text: 'Yes. Everything is ready.', receipt: 'read' as const },
  { from: 'Alice', text: 'Perfect.', receipt: 'delivered' as const },
];

const RECEIPT_LABEL: Record<'sent' | 'delivered' | 'read', string> = {
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
};

/** Chat: a short thread with receipts, and one bubble still typing. */
export function ChatDemo() {
  return (
    <DemoPanel title="Raven Chat · support-room-42">
      <ul className="flex flex-col gap-3 p-5">
        {MESSAGES.map((m, i) => (
          <li
            key={i}
            className="animate-fade-in flex flex-col gap-1"
            style={{
              alignItems: m.from === 'Alice' ? 'flex-start' : 'flex-end',
              animationDelay: `${i * 110}ms`,
              animationFillMode: 'backwards',
            }}
          >
            <span className="text-[11px] font-medium text-muted">{m.from}</span>
            <span
              className={`max-w-[80%] rounded-(--radius-panel) px-3.5 py-2 text-sm ${
                m.from === 'Alice' ? 'bg-surface-raised text-fg' : 'bg-accent text-accent-fg'
              }`}
            >
              {m.text}
            </span>
            <span className={`text-[11px] tabular ${m.receipt === 'read' ? 'text-accent-text' : 'text-muted'}`}>
              {RECEIPT_LABEL[m.receipt]}
            </span>
          </li>
        ))}
        <li
          className="animate-fade-in flex w-fit items-center gap-1 rounded-(--radius-panel) bg-surface-raised px-3.5 py-2.5"
          style={{ animationDelay: '360ms', animationFillMode: 'backwards' }}
          aria-label="Bob is typing"
        >
          <span className="raven-typing-dot h-1.5 w-1.5 rounded-full bg-subtle" />
          <span className="raven-typing-dot h-1.5 w-1.5 rounded-full bg-subtle" />
          <span className="raven-typing-dot h-1.5 w-1.5 rounded-full bg-subtle" />
        </li>
      </ul>

      <style>{`
        .raven-typing-dot { animation: raven-typing 1.1s ease-in-out infinite; }
        .raven-typing-dot:nth-child(2) { animation-delay: 0.15s; }
        .raven-typing-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes raven-typing {
          0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </DemoPanel>
  );
}

const CHAT_LINES = [
  { from: 'Alice', text: 'Amazing stream!' },
  { from: 'Bob', text: '🔥🔥🔥' },
];

const REACTIONS = [
  { emoji: '❤️', target: 128 },
  { emoji: '👏', target: 84 },
  { emoji: '🔥', target: 52 },
];

/** Live Streaming: a host on air with viewer count, reactions, and chat. */
export function LiveDemo() {
  const viewers = useCountUp(342, true);

  return (
    <DemoPanel title="Raven Live · stream-7" note="Preview — scripted demo, not live data.">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="mono-label inline-flex items-center gap-1.5 rounded-(--radius-panel) bg-danger px-2 py-1 text-[10px] text-accent-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-fg animate-pulse-dot" />
          LIVE
        </span>
        <span className="tabular text-xs font-medium text-muted">{viewers.toLocaleString()} watching</span>
      </div>

      <div className="dot-band flex h-36 items-center justify-center bg-surface-sunken">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-subtle text-lg font-semibold text-accent-text">
          A
        </span>
      </div>

      <div className="flex items-center gap-4 border-b border-line px-5 py-3">
        {REACTIONS.map((r) => (
          <ReactionCount key={r.emoji} emoji={r.emoji} target={r.target} />
        ))}
      </div>

      <ul className="flex flex-col gap-2 px-5 py-4">
        {CHAT_LINES.map((line, i) => (
          <li
            key={i}
            className="animate-fade-in text-sm text-fg"
            style={{ animationDelay: `${200 + i * 150}ms`, animationFillMode: 'backwards' }}
          >
            <span className="font-medium text-muted">{line.from}: </span>
            {line.text}
          </li>
        ))}
      </ul>
    </DemoPanel>
  );
}

// Real preset names from packages/effects/src/presets.ts: nothing here
// is invented, and each is a pure composition of the underlying
// filters, not a separate implementation.
const PRESETS = ['vivid', 'warm', 'cool', 'cinematic', 'vintage'] as const;

/** Effects: the preset rail, not a rendered filter preview. */
export function EffectsDemo() {
  return (
    <DemoPanel title="Raven Effects · camera preview">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="font-mono text-xs text-muted">local track</span>
        <span className="mono-label rounded-(--radius-panel) border border-line px-2 py-1 text-[10px] text-muted">
          Client-side
        </span>
      </div>

      <div className="dot-band flex h-36 items-center justify-center bg-surface-sunken">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-subtle text-sm font-medium text-accent-text">
          A
        </span>
      </div>

      <div className="flex flex-wrap gap-2 p-5">
        {PRESETS.map((preset, i) => (
          <span
            key={preset}
            className={`mono-label animate-fade-in rounded-(--radius-panel) border px-2.5 py-1.5 text-[10px] ${
              preset === 'cinematic' ? 'border-accent-line bg-accent-subtle text-accent-text' : 'border-line text-muted'
            }`}
            style={{ animationDelay: `${i * 70}ms`, animationFillMode: 'backwards' }}
          >
            {preset}
          </span>
        ))}
      </div>
    </DemoPanel>
  );
}

/** Server: what the backend actually hands the client. No visual to fake. */
export function TokenDemo() {
  return (
    <DemoPanel title="Raven API · POST /v1/tokens">
      <dl className="divide-y divide-line">
        {[
          ['room', 'room-123'],
          ['identity', 'user-42'],
          ['permissions', 'join · publish · subscribe'],
          ['expires_in', '3600s'],
        ].map(([key, value], i) => (
          <div
            key={key}
            className="animate-fade-in flex items-baseline justify-between gap-4 px-5 py-3"
            style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'backwards' }}
          >
            <dt className="font-mono text-xs text-muted">{key}</dt>
            <dd className="font-mono text-xs text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-5 py-3 text-[11px] text-muted">
        Minted server-side. The browser never holds the API key.
      </p>
    </DemoPanel>
  );
}

function DemoPanel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-(--radius-panel) border border-line bg-surface">
      <div className="border-b border-line bg-surface-sunken px-5 py-2.5">
        <span className="mono-label text-[10px] text-muted">{title}</span>
      </div>
      {children}
      {note && <p className="border-t border-line px-5 py-2.5 text-[11px] text-muted">{note}</p>}
    </div>
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

function ReactionCount({ emoji, target }: { emoji: string; target: number }) {
  const value = useCountUp(target, true);
  return (
    <span className="tabular inline-flex items-center gap-1.5 text-sm text-muted">
      <span aria-hidden="true">{emoji}</span>
      {value}
    </span>
  );
}
