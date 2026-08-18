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
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Section heading that sits directly on the canvas rather than inside a
 * Card — used to group content without stacking borders inside borders.
 */
export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
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
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`tabular mt-1.5 text-2xl font-semibold tracking-tight ${valueTone}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-subtle">{hint}</div>}
    </div>
  );
}
