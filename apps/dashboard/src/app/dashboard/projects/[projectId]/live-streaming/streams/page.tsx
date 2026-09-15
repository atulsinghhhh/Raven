import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { LiveStreamStatus, LiveStreamSummary } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { liveStreamingTabs, ProductTabs } from '@/components/shell/product-tabs';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { IconLiveStreaming } from '@/components/ui/icons';
import { StatusFilter, StreamsList } from './streams-list';

const STATUS_FILTERS: LiveStreamStatus[] = ['CREATED', 'LIVE', 'ENDED'];

export default async function LiveStreamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { projectId } = await params;
  const { status: rawStatus } = await searchParams;
  const status = (STATUS_FILTERS as string[]).includes(rawStatus ?? '') ? (rawStatus as LiveStreamStatus) : undefined;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let streams: LiveStreamSummary[];
  try {
    streams = await ravenApi.listLiveStreams(token, projectId, status);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="Project not found"
          description="This project may have been archived, or it belongs to a different account."
          action={
            <ButtonLink href="/dashboard/projects" variant="primary">
              Back to projects
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load streams"
        description="The Control API is unreachable right now. Your streams are unaffected — retry in a moment."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`${base}/live-streaming/streams`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Streams"
        description="Every live stream your backend has created in this project."
        actions={<StatusFilter base={`${base}/live-streaming/streams`} current={status} />}
      />
      <ProductTabs tabs={liveStreamingTabs(base)} active="Streams" />

      {streams.length === 0 ? (
        <EmptyState
          icon={<IconLiveStreaming className="size-7" />}
          title={status ? `No ${status.toLowerCase()} streams` : 'No live streams yet'}
          description={
            status
              ? 'Try a different status, or view all streams.'
              : 'Streams are created from your backend — POST /v1/live-streams via @ravenkash/server or livqeno-sdk — and appear here the moment they exist.'
          }
          action={
            status ? (
              <ButtonLink href={`${base}/live-streaming/streams`} variant="secondary">
                Clear filter
              </ButtonLink>
            ) : (
              <ButtonLink href={`${base}/sdks`} variant="primary">
                View SDKs
              </ButtonLink>
            )
          }
        />
      ) : (
        <StreamsList
          key={`${projectId}:${status ?? ''}`}
          projectId={projectId}
          basePath={`${base}/live-streaming/streams`}
          initialStreams={streams}
          status={status}
        />
      )}

      <p className="text-xs text-subtle">Showing up to the 200 most recent streams.</p>
    </div>
  );
}
