import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';

/** Header, the add-an-endpoint form card, then the endpoints list card. */
export default function WebhooksLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading webhooks
      </span>

      <div>
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-2.5 h-3 w-96" />
      </div>

      <CardSkeleton lines={3} />
      <CardSkeleton lines={4} />
    </div>
  );
}
