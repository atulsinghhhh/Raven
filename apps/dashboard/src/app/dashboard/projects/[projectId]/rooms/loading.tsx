import { Skeleton, StatGridSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Header + occupancy summary row + the room table. */
export default function RoomsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading rooms
      </span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-2.5 h-3 w-80" />
        </div>
        <Skeleton className="h-9 w-48 rounded-md" />
      </div>

      <StatGridSkeleton count={3} />

      <TableSkeleton rows={6} cols={5} />
    </div>
  );
}
