/**
 * Skeletons mirror the shape of the content they stand in for, so the
 * layout doesn't jump when real data lands. Deliberately no spinners —
 * a full-page spinner tells the developer nothing about what's coming.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-sunken ${className}`} aria-hidden="true" />;
}

export function SkeletonText({ lines = 1, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2.5 h-7 w-14" />
    </div>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface" aria-hidden="true">
      <div className="flex gap-4 border-b border-line bg-surface-sunken px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-3.5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <Skeleton className="h-3.5 w-32" />
      <div className="mt-4">
        <SkeletonText lines={lines} />
      </div>
    </div>
  );
}

/** Page-level fallback: header + stat row + table, the most common shape. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>
      <StatGridSkeleton />
      <TableSkeleton />
    </div>
  );
}
