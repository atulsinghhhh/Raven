import { HeroNetwork } from './HeroNetwork';
import { DASHBOARD_URL, DOCS_URL } from '../lib/links';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-5xl px-6 pt-24 pb-4 md:pt-32">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mono-label inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
            Real-time infrastructure, managed
          </span>

          <h1 className="mt-8 text-[2.75rem] font-light leading-[1.05] tracking-[-0.02em] text-fg md:text-7xl md:tracking-[-0.03em]">
            Real-time infrastructure,
            <br />
            built for developers.
          </h1>

          <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-muted md:text-lg">
            Build audio, video, messaging and live streaming without building the real-time infrastructure yourself.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`${DASHBOARD_URL}/signup`}
              className="mono-label rounded-full bg-accent px-6 py-3 text-[12px] text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Start building →
            </a>
            <a
              href={DOCS_URL}
              className="mono-label rounded-full border border-line px-6 py-3 text-[12px] text-fg transition-colors hover:border-line-strong hover:bg-surface"
            >
              Read the docs →
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-20 pt-8 md:pb-28">
        <HeroNetwork />
      </div>
    </section>
  );
}
