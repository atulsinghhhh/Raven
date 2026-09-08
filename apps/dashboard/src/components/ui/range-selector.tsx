import { RANGES, RANGE_LABEL, RANGE_SHORT, type Range } from '@/lib/format';

/**
 * Plain links, not a client-side control: the range is a URL param the
 * server component reads, so switching it is a normal navigation with no
 * JS and no hydration cost. Shareable/bookmarkable as a side effect.
 *
 * Only the four windows the MetricsService actually implements are
 * offered; anything else would silently resolve to 1h server-side and
 * show numbers that don't match the label.
 */
export function RangeSelector({
  basePath,
  current,
  ranges = RANGES,
}: {
  basePath: string;
  current: Range;
  /** Which windows to offer. Defaults to all of them; overview-style pages
   *  pass the day-scale subset. */
  ranges?: readonly Range[];
}) {
  return (
    <nav aria-label="Time range" className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5">
      {ranges.map((range) => {
        const active = range === current;
        return (
          <a
            key={range}
            href={`${basePath}?range=${range}`}
            aria-current={active ? 'true' : undefined}
            aria-label={RANGE_LABEL[range]}
            className={`mono-label rounded-sm px-2 py-1 text-[11px] transition-colors ${
              active ? 'bg-accent-subtle text-accent-text' : 'text-muted hover:bg-surface-raised hover:text-fg'
            }`}
          >
            {RANGE_SHORT[range]}
          </a>
        );
      })}
    </nav>
  );
}
