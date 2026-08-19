import { CodeSample } from './CodeSample';
import { ConnectionDiagram } from './ConnectionDiagram';
import { DASHBOARD_URL, DOCS_URL } from '../lib/links';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <BackgroundGlow />

      <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
            Real-time infrastructure, managed
          </span>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-fg md:text-6xl">
            Real-time infrastructure
            <br className="hidden md:block" /> for developers.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg text-muted">
            Add reliable audio, video, messaging, and live streaming to
            your application without building real-time infrastructure
            from scratch — token-based auth, connection diagnostics, and
            SDKs for web, mobile, and server, all on infrastructure Raven
            runs for you.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`${DASHBOARD_URL}/signup`}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-raven-sm transition-colors hover:bg-accent-hover"
            >
              Get started
            </a>
            <a
              href={DOCS_URL}
              className="rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-raised"
            >
              Read documentation
            </a>
          </div>
        </div>

        <div className="mt-16 grid gap-8 md:mt-20 md:grid-cols-2 md:items-center">
          <div className="order-2 md:order-1">
            <CodeSample />
          </div>
          <div className="order-1 md:order-2">
            <ConnectionDiagram />
          </div>
        </div>
      </div>
    </section>
  );
}

function BackgroundGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute left-1/2 top-[-10rem] h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-accent/[0.08] blur-3xl" />
    </div>
  );
}
