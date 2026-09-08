import { HeroNetwork } from './HeroNetwork';
import { DASHBOARD_URL, DOCS_URL } from '../lib/links';

/**
 * Centered hero, in the reference's proportions: a small framed mark, a
 * light display headline with the accent carried by two keywords rather
 * than the whole line, two lines of subcopy, and a pair of 4px buttons.
 *
 * The network diagram sits below in its own borderless full-bleed
 * strip, so the fold is type-only and the graphic reads as a separate
 * beat instead of competing with the headline.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-4xl px-6 pt-20 pb-16 text-center md:pt-28 md:pb-20">
        <DotMark />

        <h1 className="display mx-auto mt-12 max-w-3xl text-balance text-[2.5rem] text-fg sm:text-5xl md:text-6xl">
          Build <span className="kw">audio</span>, <span className="kw">video</span>, and{' '}
          <span className="kw">live</span> products
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted md:text-lg">
          A developer platform for real-time communication — calls, messaging, live streaming, and camera
          effects behind one token model and one set of SDKs.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-2.5">
          <a
            href={`${DASHBOARD_URL}/register`}
            className="rounded-(--radius-panel) bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Start building
          </a>
          <a
            href={DOCS_URL}
            className="inline-flex items-center gap-2.5 rounded-(--radius-panel) border border-line px-4 py-2.5 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface"
          >
            <span className="mono-label rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] text-muted">
              docs
            </span>
            Read the quickstart
          </a>
        </div>
      </div>

      {/* Borderless, full-bleed: the diagram is the brand graphic, not a
          panel, so it gets no frame of its own. */}
      <div className="mx-auto max-w-5xl px-6 pb-24 md:pb-32">
        <HeroNetwork />
      </div>
    </section>
  );
}

/**
 * The framed dot lattice above the headline. One dot lights and travels
 * the grid: a nod to a packet crossing the network, at a size small
 * enough that it reads as a mark instead of an illustration.
 */
function DotMark() {
  const CELLS = 100;

  return (
    <div className="mx-auto grid h-[104px] w-[104px] grid-cols-10 gap-[3px] rounded-(--radius-panel) border border-line p-3" aria-hidden="true">
      {Array.from({ length: CELLS }, (_, i) => (
        <span
          key={i}
          className="raven-dot h-[3px] w-[3px] self-center justify-self-center rounded-full bg-line-strong"
          style={{ animationDelay: `${(i % 10) * 0.09 + Math.floor(i / 10) * 0.09}s` }}
        />
      ))}

      <style>{`
        .raven-dot {
          animation: raven-dot-lit 3.2s ease-in-out infinite;
        }
        @keyframes raven-dot-lit {
          0%, 88%, 100% { background: var(--line-strong); }
          6% { background: var(--accent); }
        }
      `}</style>
    </div>
  );
}
