import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';

/** Header, the create-a-key form card, the keys list card, then the
 *  "how Livqeno stores your keys" info card. */
export default function ApiKeysLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading API keys
      </span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-2.5 h-3 w-96" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <CardSkeleton lines={2} />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={3} />
    </div>
  );
}
