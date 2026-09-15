import { Skeleton, StatGridSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Header, the 4 summary stats, the search + filter-chip row, then the
 *  merged log table. */
export default function LogsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading logs
      </span>

      <div>
        <Skeleton className="h-6 w-20" />
        <Skeleton className="mt-2.5 h-3 w-full max-w-2xl" />
      </div>

      <StatGridSkeleton count={4} />

      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full rounded-md sm:w-72" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>

      <TableSkeleton rows={8} cols={5} />
    </div>
  );
}
