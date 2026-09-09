/**
 * A bounded quantity against its ceiling — the shape a quota needs and a
 * StatCard cannot give: the number alone doesn't say how close to the edge
 * it is, and a bar alone doesn't say what it's a bar of.
 *
 * `<meter>`, not a styled `<div>`. The element exists for exactly this,
 * carries `value`/`min`/`max` to assistive tech without an ARIA
 * incantation, and is announced as a measurement rather than a decoration.
 * Its native rendering is replaced (it is inconsistent across engines and
 * ignores the theme), which is why the track and fill are drawn behind it
 * while the element itself stays in the tree, sized to nothing.
 *
 * Tone follows how much is left, never how much is used: "82% used" and
 * "18% left" are the same fact, and it is the second one a developer is
 * actually deciding on.
 */
export function Meter({
  label,
  valueLabel,
  percent,
  value,
  max,
  hint,
  tone,
}: {
  label: React.ReactNode;
  /** The headline reading, e.g. "4,812 / 20,000 minutes". */
  valueLabel: React.ReactNode;
  /** 0-100. Clamped here as well as server-side: this component must not be able to overflow its track. */
  percent: number;
  /** The raw quantities, for the native `<meter>` semantics. */
  value: number;
  max: number;
  hint?: React.ReactNode;
  /** Omit to derive from how much is left. */
  tone?: 'default' | 'warning' | 'danger';
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const derived = tone ?? (clamped >= 100 ? 'danger' : clamped >= 80 ? 'warning' : 'default');

  const fill = derived === 'danger' ? 'bg-danger' : derived === 'warning' ? 'bg-warning' : 'bg-accent';
  const text = derived === 'danger' ? 'text-danger-text' : derived === 'warning' ? 'text-warning-text' : 'text-fg';

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="mono-label text-[11px] text-muted">{label}</span>
        <span className={`tabular font-mono text-sm ${text}`}>{valueLabel}</span>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={`h-full rounded-full transition-[width] ${fill}`}
          // A spent allowance must still read as spent: 0% would render an
          // empty track, which is what an unused one looks like.
          style={{ width: `${Math.max(clamped, clamped > 0 ? 1.5 : 0)}%` }}
          aria-hidden="true"
        />
        {/* Sized to nothing and visually hidden, but present: this is what
            a screen reader reads, and it carries the real numbers. */}
        <meter className="sr-only" min={0} max={max} value={Math.min(value, max)}>
          {valueLabel}
        </meter>
      </div>

      {hint && <p className="mt-2 text-xs leading-relaxed text-subtle">{hint}</p>}
    </div>
  );
}
