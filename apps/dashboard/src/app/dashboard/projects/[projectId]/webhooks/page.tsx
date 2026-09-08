import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/states';
import { WebhooksManager } from './webhooks-manager';

/**
 * Webhook endpoints for this project. Project-scoped rather than
 * chat-scoped: chat is the only producer today, but the delivery
 * pipeline is shared, so later phases publish through the same endpoints
 * instead of needing a second page here.
 */
export default async function WebhooksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  let endpoints;
  try {
    endpoints = await ravenApi.listWebhooks(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Unable to load webhooks"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`/dashboard/projects/${projectId}/webhooks`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Webhooks"
        description="Receive chat events on your own backend. Delivery is asynchronous and retried — it never sits on the message path."
      />
      <WebhooksManager projectId={projectId} initialEndpoints={endpoints} />
    </div>
  );
}
