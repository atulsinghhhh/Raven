import { DASHBOARD_URL, DOCS_URL } from '../lib/links';
import { Reveal } from './Reveal';

export function FinalCTA() {
  return (
    <section className="border-t border-line py-24">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <Reveal>
          <h2 className="text-3xl font-light tracking-tight text-fg md:text-4xl">
            Build your next real-time experience with Raven.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            RTC, messaging, live streaming, and effects — through APIs developers can actually enjoy using.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
        </Reveal>
      </div>
    </section>
  );
}
