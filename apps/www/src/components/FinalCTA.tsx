import { DASHBOARD_URL, DOCS_URL } from '../lib/links';
import { Reveal } from './Reveal';

export function FinalCTA() {
  return (
    <section className="border-t border-line py-24">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight text-fg md:text-4xl">
            Build your next real-time experience with Raven.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            RTC, messaging, and live streaming — through APIs developers can actually enjoy using.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`${DASHBOARD_URL}/signup`}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-raven-sm transition-colors hover:bg-accent-hover"
            >
              Start building
            </a>
            <a
              href={DOCS_URL}
              className="rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-raised"
            >
              Read the docs
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
