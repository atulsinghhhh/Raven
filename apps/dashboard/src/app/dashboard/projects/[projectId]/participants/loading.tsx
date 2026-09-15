import { Skeleton, StatCardSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Header, the product tabs, the 3 recent-activity stats, the filter row,
 *  then the participants table. */
export default function ParticipantsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading participants
      </span>

      <div>
        <Skeleton className="h-6 w-36" />
        <Skeleton className="mt-2.5 h-3 w-full max-w-2xl" />
      </div>

      <div className="flex items-center gap-4 border-b border-line pb-3">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-20" />
      </div>

      <section>
        <Skeleton className="h-3.5 w-32" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-32" />
        <div className="mt-3 mb-3 flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-full rounded-md sm:w-72" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>
        <TableSkeleton rows={6} cols={7} />
      </section>
    </div>
  );
}
