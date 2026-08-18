import { Skeleton, StatGridSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Header + error breakdown row + the error table. */
export default function ErrorsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading errors
      </span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-2.5 h-3 w-80" />
        </div>
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>

      <StatGridSkeleton count={3} />

      <TableSkeleton rows={8} cols={5} />
    </div>
  );
}
