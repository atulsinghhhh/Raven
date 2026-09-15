import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';

/** Header, the add-a-member form card, then the members list card. */
export default function MembersLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading members
      </span>

      <div>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-2.5 h-3 w-96" />
      </div>

      <CardSkeleton lines={2} />
      <CardSkeleton lines={5} />
    </div>
  );
}
