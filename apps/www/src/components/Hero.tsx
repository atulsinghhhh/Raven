import { HeroNetwork } from './HeroNetwork';
import { DASHBOARD_URL, DOCS_ROUTES, DOCS_URL } from '../lib/links';

/**
 * The opening statement. Two display lines — the claim, then the
 * promise — over a violet-lit near-black canvas, with the live
 * infrastructure topology below as its own full-bleed beat.
 *
 * The headline is the brand element here: the atmosphere (`.aurora`)
 * and the eyebrow's pulsing live dot say "this thing is running" before
 * the diagram scrolls into view. No card, no frame, no illustration
 * competing with the type above the fold.
 */
export function Hero() {
  return (
    <section className="aurora relative overflow-hidden">
      <div className="mx-auto max-w-5xl px-6 pt-24 pb-16 text-center md:pt-32 md:pb-20">
        <p className="mono-label inline-flex items-center gap-2.5 rounded-(--radius-panel) border border-line bg-surface/60 px-3 py-1.5 text-[10px] text-muted">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
          </span>
          Realtime infrastructure — audio · video · chat · live
        </p>

        <h1 className="display mx-auto mt-10 max-w-4xl text-balance text-5xl text-fg sm:text-6xl md:text-7xl">
          Build real-time.
          <br />
          Ship without the <span className="kw">infrastructure</span>.
        </h1>

        <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-muted md:text-lg">
          Audio, video, chat, and live streaming infrastructure — with the APIs and SDKs to put real-time inside
          your application. Your app connects; Raven runs the network.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={`${DASHBOARD_URL}/signup`}
            className="glow-accent rounded-(--radius-panel) bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Start building
          </a>
          <a
            href={DOCS_URL}
            className="inline-flex items-center gap-2.5 rounded-(--radius-panel) border border-accent-line px-4 py-2.5 text-[13px] font-medium text-fg transition-colors hover:border-accent-text hover:bg-canvas"
          >
            <span className="mono-label rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] text-muted">
              docs
            </span>
            Read the documentation
          </a>
          <a
            href={DOCS_ROUTES.sdkWeb}
            className="mono-label px-2 py-2.5 text-[11px] text-muted transition-colors hover:text-accent-text"
          >
            Explore SDKs →
          </a>
        </div>
      </div>

      {/* Borderless, full-bleed: the topology is the brand graphic, not
          a panel, so it gets no frame of its own. */}
      <div className="mx-auto max-w-6xl px-6 pb-24 md:pb-32">
        <HeroNetwork />
      </div>
    </section>
  );
}
