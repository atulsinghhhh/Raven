import { Skeleton, StatGridSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Header, the connection metric row, then the connections table. */
export default function ConnectionsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading connections
      </span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2.5 h-3 w-80" />
        </div>
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>

      <StatGridSkeleton />

      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
