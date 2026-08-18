import { CardSkeleton, Skeleton, StatCardSkeleton, StatGridSkeleton } from '@/components/ui/skeleton';

/** Mirrors the overview: header + range, live activity row, RTC rate
 *  tiles, the two recent-activity cards, then infrastructure. */
export default function OverviewLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading project overview
      </span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-52" />
          <Skeleton className="mt-2.5 h-3 w-72" />
        </div>
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>

      <section>
        <Skeleton className="h-3.5 w-28" />
        <div className="mt-3">
          <StatGridSkeleton />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-32" />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>

      <CardSkeleton lines={2} />
    </div>
  );
}
