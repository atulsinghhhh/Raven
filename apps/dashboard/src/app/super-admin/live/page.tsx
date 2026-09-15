import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import {
  getLiveOverview,
  listLiveStreams,
  type LiveOverview,
  type LiveStreamListItem,
  type LiveStreamPage,
  type LiveStreamStatus,
} from '@/lib/super-admin/live';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Button, ButtonLink } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { IconLiveStreaming } from '@/components/ui/icons';
import { formatCount, formatDateTime, formatDuration, formatRelative } from '@/lib/format';

const PAGE_LIMIT = 25;
const STATUSES: LiveStreamStatus[] = ['CREATED', 'STARTING', 'LIVE', 'ENDING', 'ENDED'];

/**
 * Platform-wide Live Streaming operations (spec §12) — every `LiveStream`
 * across every project, not one developer's own. This is the Super Admin
 * Portal's read-only console for it: overview stats, then every stream
 * with its project, developer, host, and peak viewers, linking to a full
 * detail page per stream.
 */
export default async function SuperAdminLivePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string }>;
}) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as LiveStreamStatus) ? (params.status as LiveStreamStatus) : undefined;
  const offset = Math.max(0, Number.parseInt(params.offset ?? '0', 10) || 0);

  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/live');

  let overview: LiveOverview;
  let page: LiveStreamPage;
  try {
    [overview, page] = await Promise.all([
      getLiveOverview(token),
      listLiveStreams(token, { status, offset, limit: PAGE_LIMIT }),
    ]);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) redirect('/dashboard');
    return (
      <ErrorState
        title="Unable to load Live Streaming data"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref="/super-admin/live"
      />
    );
  }

  const hasNext = offset + page.items.length < page.total;
  const hasPrev = offset > 0;
  const query = (nextOffset: number) => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    if (nextOffset > 0) search.set('offset', String(nextOffset));
    const qs = search.toString();
    return qs ? `/super-admin/live?${qs}` : '/super-admin/live';
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Live Streaming"
        description="Every live stream across every project — active streams, history, hosts, and failures."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Active streams"
          value={formatCount(overview.activeStreams)}
          tone={overview.activeStreams > 0 ? 'success' : 'default'}
          hint="Currently LIVE"
        />
        <StatCard label="Streams today" value={formatCount(overview.streamsToday)} hint="Created since 00:00 UTC" />
        <StatCard
          label="Peak viewers today"
          value={formatCount(overview.peakViewersToday)}
          hint="Highest peakViewerCount among today's streams"
        />
        <StatCard
          label="Failed streams"
          value={formatCount(overview.failedStreams)}
          tone={overview.failedStreams > 0 ? 'danger' : 'default'}
          hint="Egress pipelines stuck FAILED, all-time"
        />
        <StatCard
          label="Total viewers today"
          value={formatCount(overview.totalViewersToday)}
          hint="Sum of peakViewerCount across today's streams"
        />
        <StatCard
          label="Avg. stream duration"
          value={
            overview.avgStreamDurationMsToday === null ? (
              <NoDataYet label="No streams ended today" />
            ) : (
              formatDuration(overview.avgStreamDurationMsToday)
            )
          }
          hint="Streams that ended today"
        />
        <StatCard
          label="Total stream time today"
          value={formatDuration(overview.sumStreamDurationMsToday)}
          hint="Sum of durations, streams ended today"
        />
        <StatCard label="Total streams" value={formatCount(overview.totalStreams)} hint="All-time, every project" />
      </div>

      <section>
        <SectionHeader title="All streams" subtitle={`${formatCount(page.total)} total, newest first.`} />

        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <Select id="status" name="status" label="Status" defaultValue={status ?? ''} className="w-44">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {status && (
            <ButtonLink href="/super-admin/live" variant="ghost">
              Clear
            </ButtonLink>
          )}
        </form>

        {page.items.length === 0 ? (
          <EmptyState
            icon={<IconLiveStreaming className="size-7" />}
            title="No live streams found"
            description={
              status
                ? `No streams currently match status ${status}.`
                : 'No developer has created a live stream on the platform yet.'
            }
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <Table>
                  <THead>
                    <TH>Stream</TH>
                    <TH>Project</TH>
                    <TH>Developer</TH>
                    <TH>Status</TH>
                    <TH>Host</TH>
                    <TH align="right">Peak viewers</TH>
                    <TH>Started</TH>
                  </THead>
                  <TBody>
                    {page.items.map((stream) => (
                      <TR key={stream.id} interactive>
                        <TD>
                          <a
                            href={`/super-admin/live/streams/${stream.id}`}
                            className="font-medium text-fg hover:text-accent-text hover:underline"
                          >
                            {stream.title}
                          </a>
                        </TD>
                        <TD>
                          <span className="text-muted">{stream.projectName}</span>
                        </TD>
                        <TD>
                          <span className="text-muted">{stream.ownerEmail}</span>
                        </TD>
                        <TD>
                          <StreamStatusBadge status={stream.status} />
                        </TD>
                        <TD>{stream.hostIdentity ?? <Dash />}</TD>
                        <TD align="right">
                          <span className="tabular text-fg">{formatCount(stream.peakViewerCount)}</span>
                        </TD>
                        <TD>
                          <span className="tabular text-xs text-muted">
                            {stream.startedAt ? formatRelative(stream.startedAt) : <Dash />}
                          </span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="sm:hidden">
              <MobileList>
                {page.items.map((stream) => (
                  <MobileRow key={stream.id} href={`/super-admin/live/streams/${stream.id}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{stream.title}</span>
                      <StreamStatusBadge status={stream.status} />
                    </div>
                    <MobileField label="Project">{stream.projectName}</MobileField>
                    <MobileField label="Developer">{stream.ownerEmail}</MobileField>
                    <MobileField label="Host">{stream.hostIdentity ?? <Dash />}</MobileField>
                    <MobileField label="Peak viewers">
                      <span className="tabular">{formatCount(stream.peakViewerCount)}</span>
                    </MobileField>
                    <MobileField label="Started">
                      {stream.startedAt ? formatDateTime(stream.startedAt) : <Dash />}
                    </MobileField>
                  </MobileRow>
                ))}
              </MobileList>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                Showing {formatCount(offset + 1)}–{formatCount(offset + page.items.length)} of {formatCount(page.total)}
              </span>
              <div className="flex gap-2">
                <ButtonLink
                  href={hasPrev ? query(Math.max(0, offset - PAGE_LIMIT)) : '#'}
                  variant="secondary"
                  size="sm"
                  aria-disabled={!hasPrev}
                  className={!hasPrev ? 'pointer-events-none opacity-50' : ''}
                >
                  Previous
                </ButtonLink>
                <ButtonLink
                  href={hasNext ? query(offset + PAGE_LIMIT) : '#'}
                  variant="secondary"
                  size="sm"
                  aria-disabled={!hasNext}
                  className={!hasNext ? 'pointer-events-none opacity-50' : ''}
                >
                  Next
                </ButtonLink>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function statusTone(status: LiveStreamListItem['status']): BadgeTone {
  if (status === 'LIVE') return 'live';
  if (status === 'ENDED') return 'neutral';
  if (status === 'CREATED') return 'info';
  return 'warning';
}

function StreamStatusBadge({ status }: { status: LiveStreamListItem['status'] }) {
  return <Badge tone={statusTone(status)}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}
