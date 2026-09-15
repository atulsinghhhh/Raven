import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Header + status filter, the product tabs, then the streams table. */
export default function StreamsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading streams
      </span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-2.5 h-3 w-80" />
        </div>
        <Skeleton className="h-8 w-56 rounded-md" />
      </div>

      <div className="flex items-center gap-4 border-b border-line pb-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
      </div>

      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
