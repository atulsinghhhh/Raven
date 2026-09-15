import { CardSkeleton, Skeleton, StatGridSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Breadcrumb + header, the room metadata card, live participants, the
 *  live-quality stats, the recent-connections table, then the test-token card. */
export default function RoomDetailLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading room
      </span>

      <header className="flex flex-col gap-3">
        <Skeleton className="h-3 w-20" />
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-2.5 h-3 w-80" />
        </div>
      </header>

      <CardSkeleton lines={4} />

      <section>
        <Skeleton className="h-3.5 w-32" />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-36" />
        <div className="mt-3">
          <StatGridSkeleton count={4} />
        </div>
      </section>

      <section>
        <Skeleton className="h-3.5 w-40" />
        <div className="mt-3">
          <TableSkeleton rows={6} cols={5} />
        </div>
      </section>

      <CardSkeleton lines={2} />
    </div>
  );
}
