import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { LiveStreamStatus, LiveStreamSummary } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { liveStreamingTabs, ProductTabs } from '@/components/shell/product-tabs';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { IconLiveStreaming } from '@/components/ui/icons';
import { formatCount, formatDateTime, formatDuration } from '@/lib/format';

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
              : 'Streams are created from your backend — POST /v1/live-streams via @ravenkash/server or raven-sdk — and appear here the moment they exist.'
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
        <>
          <div className="hidden sm:block">
            <TableWrap>
              <Table>
                <THead>
                  <TH>Stream</TH>
                  <TH>Status</TH>
                  <TH>Host</TH>
                  <TH align="right">Peak viewers</TH>
                  <TH>Started</TH>
                  <TH align="right">Duration</TH>
                </THead>
                <TBody>
                  {streams.map((stream) => (
                    <TR key={stream.id} interactive>
                      <TD className="max-w-[16rem]">
                        <a
                          href={`${base}/live-streaming/streams/${stream.id}`}
                          className="block truncate text-sm font-medium text-fg hover:text-accent-text hover:underline"
                          title={stream.title}
                        >
                          {stream.title}
                        </a>
                        <span className="block truncate font-mono text-[0.6875rem] text-subtle">{stream.id}</span>
                      </TD>
                      <TD>
                        <StreamStatusBadge status={stream.status} />
                      </TD>
                      <TD>
                        {stream.hosts[0] ? (
                          <span className="truncate text-sm text-muted">{stream.hosts[0].identity}</span>
                        ) : (
                          <Dash />
                        )}
                      </TD>
                      <TD align="right">
                        <span className="tabular text-sm text-muted">{formatCount(stream.peakViewerCount)}</span>
                      </TD>
                      <TD>
                        {stream.startedAt ? (
                          <span className="tabular text-xs text-muted">{formatDateTime(stream.startedAt)}</span>
                        ) : (
                          <Dash />
                        )}
                      </TD>
                      <TD align="right">
                        <span className="tabular text-xs text-muted">{streamDuration(stream)}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </div>

          <div className="sm:hidden">
            <MobileList>
              {streams.map((stream) => (
                <MobileRow key={stream.id} href={`${base}/live-streaming/streams/${stream.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{stream.title}</span>
                      <span className="block truncate font-mono text-[0.6875rem] text-subtle">{stream.id}</span>
                    </span>
                    <StreamStatusBadge status={stream.status} />
                  </div>
                  <div className="mt-3 border-t border-line pt-2">
                    <MobileField label="Host">{stream.hosts[0]?.identity ?? '—'}</MobileField>
                    <MobileField label="Peak viewers">{formatCount(stream.peakViewerCount)}</MobileField>
                    <MobileField label="Duration">{streamDuration(stream)}</MobileField>
                  </div>
                </MobileRow>
              ))}
            </MobileList>
          </div>
        </>
      )}

      <p className="text-xs text-subtle">Showing up to the 200 most recent streams.</p>
    </div>
  );
}

function StatusFilter({ base, current }: { base: string; current?: LiveStreamStatus }) {
  return (
    <nav aria-label="Filter by status" className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5">
      <a
        href={base}
        aria-current={!current ? 'true' : undefined}
        className={`rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
          !current ? 'bg-accent-subtle text-accent-text' : 'text-muted hover:bg-surface-raised hover:text-fg'
        }`}
      >
        All
      </a>
      {STATUS_FILTERS.map((status) => (
        <a
          key={status}
          href={`${base}?status=${status}`}
          aria-current={current === status ? 'true' : undefined}
          className={`rounded-sm px-2 py-1 text-xs font-medium capitalize transition-colors ${
            current === status ? 'bg-accent-subtle text-accent-text' : 'text-muted hover:bg-surface-raised hover:text-fg'
          }`}
        >
          {status.toLowerCase()}
        </a>
      ))}
    </nav>
  );
}

function StreamStatusBadge({ status }: { status: LiveStreamSummary['status'] }) {
  if (status === 'LIVE') return <Badge tone="live">Live</Badge>;
  if (status === 'ENDED') return <Badge tone="neutral">Ended</Badge>;
  if (status === 'CREATED') return <Badge tone="info">Created</Badge>;
  return <Badge tone="warning">{status.toLowerCase()}</Badge>;
}

/** LIVE streams measure against now(); ended ones against their own endedAt. Never started = no duration to show. */
function streamDuration(stream: LiveStreamSummary): string {
  if (!stream.startedAt) return '—';
  const start = new Date(stream.startedAt).getTime();
  const end = stream.endedAt ? new Date(stream.endedAt).getTime() : Date.now();
  return formatDuration(end - start);
}
