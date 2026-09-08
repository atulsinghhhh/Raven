/*
 * Card, section and stat chrome. The heading components all take an
 * optional `eyebrow`: a mono-uppercase kicker above the title, the same
 * device the marketing site puts over every section. It's optional
 * precisely so the ~50 existing call sites keep working untouched and
 * can adopt it one page at a time.
 */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${padded ? 'p-5' : ''} ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <span className="mono-label mb-1.5 block text-[11px] text-muted">{eyebrow}</span>}
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Section heading that sits directly on the canvas instead of inside a
 * Card: used to group content without stacking borders inside borders.
 */
export function SectionHeader({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <span className="mono-label mb-1 block text-[11px] text-muted">{eyebrow}</span>}
        <h2 className="text-[0.8125rem] font-semibold tracking-tight text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A single number with its label. `hint` carries the caveat when a value
 * needs one ("across 50 most recent") so the number itself never has to
 * be read with an asterisk.
 *
 * The number is set in mono and the label in mono-uppercase: a metric
 * tile is closer to an instrument reading than to prose, and mono
 * figures line up across a row of tiles the way proportional ones don't.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const valueTone =
    tone === 'success'
      ? 'text-success-text'
      : tone === 'warning'
        ? 'text-warning-text'
        : tone === 'danger'
          ? 'text-danger-text'
          : 'text-fg';

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mono-label text-[11px] text-muted">{label}</div>
      <div className={`tabular mt-2 font-mono text-[1.625rem] leading-none font-normal ${valueTone}`}>{value}</div>
      {hint && <div className="mt-2 text-xs text-subtle">{hint}</div>}
    </div>
  );
}
