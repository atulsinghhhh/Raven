'use client';

import { useCountUp } from '../lib/useCountUp';
import { useInView } from '../lib/useInView';

/**
 * The full-bleed graph-paper band, in the slot the reference gives to
 * its scale numbers.
 *
 * Deliberately counts, not benchmarks. Livqeno publishes no uptime,
 * latency, concurrency, or customer figures here, because none of them
 * have been measured: see the no-fake-enterprise-claims note this page
 * was built against. Every number below is something you can verify by
 * reading the SDK list or the docs, and the footnote says so out loud.
 */
const COUNTS = [
  { value: 4, suffix: '', label: 'Products on one control plane' },
  { value: 7, suffix: '', label: 'SDKs and a CLI' },
  { value: 1, suffix: '', label: 'Token model across all of them' },
  { value: 0, suffix: '', label: 'API keys in the browser' },
];

// The dependencies the dashboard reports health for, in the order the
// real project overview page lists them.
const COMPONENTS = ['Control API', 'Authentication', 'Signaling', 'SFU', 'TURN'];

export function ScaleBand() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="border-t border-line pt-24 md:pt-32">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <span className="mono-label text-[11px] text-muted">Built to run</span>
        <h2 className="display mt-4 text-3xl text-fg md:text-4xl">
          Infrastructure you don&apos;t have to <span className="kw">operate</span>
        </h2>
      </div>

      <div ref={ref} className="grid-band relative mt-16 overflow-hidden border-y border-line">
        {/* The sphere sits behind everything, centered, and never
            competes with the numbers for contrast. */}
        <Sphere />

        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2 md:gap-6">
          <dl className="flex flex-col gap-8">
            {COUNTS.map((count) => (
              <Count key={count.label} value={count.value} label={count.label} active={inView} />
            ))}
          </dl>

          <div className="md:justify-self-end">
            <span className="mono-label text-[10px] text-muted">Components Livqeno runs for you</span>
            <ul className="mt-4 flex flex-col gap-2.5">
              {COMPONENTS.map((component) => (
                <li key={component} className="mono-label flex items-center gap-2.5 text-[11px] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {component}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <p className="mx-auto max-w-2xl px-6 pt-6 text-center text-[12px] leading-relaxed text-muted">
        Counts, not benchmarks. Livqeno doesn&apos;t quote uptime, latency, or concurrency figures on this page — the
        connection numbers it does report come from live WebRTC stats in your own dashboard.
      </p>
    </section>
  );
}

function Count({ value, label, active }: { value: number; label: string; active: boolean }) {
  const shown = useCountUp(value, active);
  return (
    <div>
      <dd className="tabular font-mono text-3xl font-normal text-fg md:text-4xl">{shown}</dd>
      <dt className="mono-label mt-1.5 text-[10px] text-muted">{label}</dt>
    </div>
  );
}

function Sphere() {
  return (
    <svg
      viewBox="0 0 400 400"
      className="pointer-events-none absolute left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 opacity-50"
      aria-hidden="true"
    >
      <circle cx="200" cy="200" r="150" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      {/* Latitudes: ellipses flattening toward the poles. */}
      {[30, 62, 88, 105, 112].map((ry, i) => (
        <ellipse key={i} cx="200" cy="200" rx="150" ry={ry} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {/* Longitudes: the same, rotated a quarter turn. */}
      {[30, 62, 88, 105, 112].map((rx, i) => (
        <ellipse key={i} cx="200" cy="200" rx={rx} ry="150" fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      <circle cx="200" cy="200" r="150" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
    </svg>
  );
}
