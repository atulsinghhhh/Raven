import { CardSkeleton, Skeleton, StatCardSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Breadcrumb + header, the stream metadata card, the hosts table, the
 *  viewer stats, the chat table, the reactions card, then the timeline card. */
export default function StreamDetailLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading stream
      </span>

      <header className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="mt-2.5 h-3 w-80" />
        </div>
      </header>

      <CardSkeleton lines={5} />

      <section>
        <Skeleton className="h-3.5 w-16" />
        <div className="mt-3">
          <TableSkeleton rows={2} cols={3} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-20" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-16" />
        <div className="mt-3">
          <TableSkeleton rows={5} cols={5} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-24" />
        <div className="mt-3">
          <CardSkeleton lines={1} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-20" />
        <div className="mt-3">
          <CardSkeleton lines={4} />
        </div>
      </section>
    </div>
  );
}
