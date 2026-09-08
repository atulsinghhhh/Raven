'use client';

import { DASHBOARD_URL } from '../lib/links';
import { useInView } from '../lib/useInView';
import { useCountUp } from '../lib/useCountUp';
import { Reveal } from './Reveal';

const STATS = [
  { label: 'Active rooms', target: 12 },
  { label: 'Active participants', target: 184 },
  { label: 'Messages sent', target: 24800 },
  { label: 'Live viewers', target: 342 },
];

const DEPENDENCIES = ['Control API', 'Authentication', 'Signaling', 'SFU', 'TURN'];

/**
 * Mirrors the labels on the real project overview page
 * (apps/dashboard/.../overview/page.tsx) so this preview doesn't drift
 * from what a signed-in developer actually sees, but the numbers here
 * are a fixed illustration, never a live query.
 */
export function DashboardPreview() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="border-t border-line bg-surface-sunken/40 py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <div>
            <span className="mono-label text-[11px] text-muted">Observability</span>
            <h2 className="display mt-4 text-3xl text-fg md:text-4xl">
              See what your rooms are <span className="kw">actually doing</span>
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              Connection state, reconnects, and dependency health — the same telemetry the diagnostics section
              collects, surfaced per project.
            </p>
          </div>
        </Reveal>

        <Reveal delayMs={100}>
          <div ref={ref} className="mt-12 overflow-hidden rounded-2xl bg-surface card-lift">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <span className="text-sm font-medium text-fg">demo-project</span>
              <span className="mono-label rounded-(--radius-panel) border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-muted">
                Example project — illustrative numbers
              </span>
            </div>

            <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
              {STATS.map((stat) => (
                <StatTile key={stat.label} label={stat.label} target={stat.target} active={inView} />
              ))}
            </div>

            <div className="border-t border-line px-6 py-5">
              <span className="mono-label text-[11px] text-muted">Infrastructure</span>
              <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
                {DEPENDENCIES.map((dep) => (
                  <div key={dep}>
                    <dt className="mb-1.5 text-xs text-muted">{dep}</dt>
                    <dd className="inline-flex items-center gap-1.5 text-xs font-medium text-success-text">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      Operational
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="border-t border-line px-6 py-4 text-right">
              <a href={DASHBOARD_URL} className="mono-label text-[12px] text-accent-text hover:underline">
                Open the real dashboard →
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function StatTile({ label, target, active }: { label: string; target: number; active: boolean }) {
  const value = useCountUp(target, active);
  return (
    <div className="bg-surface p-5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="tabular mt-1.5 text-2xl font-medium tracking-tight text-fg">{value.toLocaleString()}</div>
    </div>
  );
}
