import { NoDataYet } from './states';

/**
 * Charts are plain CSS/SVG, no charting library. Everything plotted here
 * is a small bucketed series, and a library would add more bundle than
 * the entire rest of the console.
 *
 * Every chart carries an sr-only data table: a bar height is not
 * information a screen reader can use, and "accessible chart" in practice
 * means "the numbers are also available as text".
 */

export interface Bucket {
  label: string;
  value: number;
  /** Longer description for the hover title, e.g. the exact time window. */
  hint?: string;
}

export function BarChart({
  data,
  height = 120,
  emptyLabel = 'No data for this period',
  caption,
  tone = 'accent',
}: {
  data: Bucket[];
  height?: number;
  emptyLabel?: string;
  caption: string;
  tone?: 'accent' | 'danger';
}) {
  const max = Math.max(...data.map((d) => d.value), 0);

  if (data.length === 0 || max === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-line" style={{ height }}>
        <NoDataYet label={emptyLabel} />
      </div>
    );
  }

  const barColor = tone === 'danger' ? 'bg-danger' : 'bg-accent';

  return (
    <figure>
      <div className="flex items-end gap-[2px]" style={{ height }} aria-hidden="true">
        {data.map((d, i) => (
          <div key={i} className="group relative flex flex-1 items-end justify-center" title={d.hint ?? `${d.label}: ${d.value}`}>
            <div
              className={`w-full rounded-t-[2px] transition-opacity group-hover:opacity-80 ${
                d.value === 0 ? 'bg-line' : barColor
              }`}
              style={{ height: d.value === 0 ? 2 : `${Math.max((d.value / max) * 100, 3)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.6875rem] text-subtle" aria-hidden="true">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <th scope="row">{d.hint ?? d.label}</th>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

export interface Segment {
  label: string;
  value: number;
  className: string;
}

/**
 * Stacked proportion bar + legend. Used for distributions (connection
 * states, error categories) where the split matters more than the trend.
 */
export function DistributionBar({ segments, caption }: { segments: Segment[]; caption: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return <NoDataYet label="Nothing recorded in this period" />;
  }

  const visible = segments.filter((s) => s.value > 0);

  return (
    <figure>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        {visible.map((s) => (
          <div
            key={s.label}
            className={s.className}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {visible.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className={`size-2 shrink-0 rounded-[2px] ${s.className}`} aria-hidden="true" />
            <span className="text-muted">{s.label}</span>
            <span className="tabular font-medium text-fg">{s.value}</span>
            <span className="text-subtle">({Math.round((s.value / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

/**
 * Single-value progress/rate bar. `tone` is derived by the caller from
 * thresholds, not hardcoded: a 90% success rate is good for one project
 * and alarming for another.
 */
export function RateBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  const color =
    tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'danger' ? 'bg-danger' : 'bg-accent';

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}
