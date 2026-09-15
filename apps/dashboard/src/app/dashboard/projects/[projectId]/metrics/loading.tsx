import { CardSkeleton, Skeleton, StatCardSkeleton, StatGridSkeleton } from '@/components/ui/skeleton';

/** Header + range selector, the 4 headline stats, the 3 connection-quality
 *  tiles, the two activity-over-time charts, the two distributions, then
 *  the "what Livqeno does not measure" card. */
export default function MetricsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading metrics
      </span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-2.5 h-3 w-96" />
        </div>
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>

      <section>
        <Skeleton className="h-3.5 w-28" />
        <div className="mt-3">
          <StatGridSkeleton count={4} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-40" />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-36" />
        <div className="mt-3 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={4} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-28" />
        <div className="mt-3 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-52" />
        <div className="mt-3">
          <CardSkeleton lines={4} />
        </div>
      </section>
    </div>
  );
}
