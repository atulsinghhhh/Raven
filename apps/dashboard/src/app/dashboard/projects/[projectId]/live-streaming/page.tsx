import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { LiveStreamSummary } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { liveStreamingTabs, ProductTabs } from '@/components/shell/product-tabs';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { IconLiveStreaming } from '@/components/ui/icons';
import { formatCount, formatRelative } from '@/lib/format';

// Live viewer counts require one SFU round trip per stream (getLiveStream
// does it, listLiveStreams on purpose doesn't). Bounded by how many
// streams are realistically LIVE at once, never by the all-time total.
const LIVE_DETAIL_FETCH_LIMIT = 20;

/**
 * Live Streaming activity for a project. A stream composes an RTC room
 * and a chat conversation, but a developer thinks of it as one product;
 * this page answers "is anything live right now, and how much", the same
 * honesty rule the Chat and RTC overviews follow: a quiet project shows
 * zeros, never a plausible-looking number nobody measured.
 */
export default async function LiveStreamingOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let streams: LiveStreamSummary[];
  try {
    streams = await ravenApi.listLiveStreams(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Unable to load live streams"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`${base}/live-streaming`}
      />
    );
  }

  if (streams.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Live Streaming" description="One host, any viewers, and a chat conversation attached automatically." />
        <ProductTabs tabs={liveStreamingTabs(base)} active="Overview" />
        <EmptyState
          icon={<IconLiveStreaming className="size-7" />}
          title="No live streams yet"
          description="Raven never creates streams from the dashboard. Your backend creates them with a project API key — raven.liveStreams.create() via @ravenkash/server or raven-sdk — and they appear here the moment they exist."
          action={
            <>
              <ButtonLink href={`${base}/sdks`} variant="primary">
                View SDKs
              </ButtonLink>
              <ButtonLink href={`${base}/api-keys`} variant="secondary">
                Create an API key
              </ButtonLink>
            </>
          }
        />
      </div>
    );
  }

  const liveStreams = streams.filter((s) => s.status === 'LIVE');
  const todayCutoff = new Date().setUTCHours(0, 0, 0, 0);
  const streamsToday = streams.filter((s) => new Date(s.createdAt).getTime() >= todayCutoff).length;
  const peakViewers = streams.reduce((max, s) => Math.max(max, s.peakViewerCount), 0);

  const liveDetails = await Promise.allSettled(
    liveStreams.slice(0, LIVE_DETAIL_FETCH_LIMIT).map((s) => ravenApi.getLiveStream(token, projectId, s.id)),
  );
  const resolvedLiveViewerCounts = liveDetails
    .filter((r): r is PromiseFulfilledResult<LiveStreamSummary> => r.status === 'fulfilled')
    .map((r) => r.value.viewerCount)
    .filter((count): count is number => count !== null);
  const liveStateAvailable = liveStreams.length === 0 || resolvedLiveViewerCounts.length > 0;
  const totalCurrentViewers = resolvedLiveViewerCounts.reduce((sum, count) => sum + count, 0);

  const recent = [...streams].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Live Streaming"
        description="One host, any number of viewers, and a chat conversation attached automatically."
        actions={
          <ButtonLink href={`${base}/live-streaming/streams`} variant="secondary">
            All streams
          </ButtonLink>
        }
      />
      <ProductTabs tabs={liveStreamingTabs(base)} active="Overview" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Active streams"
          value={formatCount(liveStreams.length)}
          tone={liveStreams.length > 0 ? 'success' : 'default'}
          hint="Currently LIVE"
        />
        <StatCard
          label="Total viewers"
          value={liveStateAvailable ? formatCount(totalCurrentViewers) : <NoDataYet label="SFU unreachable" />}
          hint={
            liveStreams.length > LIVE_DETAIL_FETCH_LIMIT
              ? `Across the ${LIVE_DETAIL_FETCH_LIMIT} most recently created live streams`
              : 'Across every stream currently LIVE'
          }
        />
        <StatCard label="Peak viewers" value={formatCount(peakViewers)} hint="Highest recorded for any single stream" />
        <StatCard label="Streams today" value={formatCount(streamsToday)} hint="Created since 00:00 UTC" />
      </div>

      <section>
        <SectionHeader
          title="Watch time"
          subtitle="Not tracked yet — Raven doesn't meter viewer-minutes in this phase. See the SDK Support Matrix in the docs for what's measured today."
        />
        <Card>
          <NoDataYet label="Analytics coming soon" />
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Recent streams"
          subtitle="Most recently created first."
          action={
            <ButtonLink href={`${base}/live-streaming/streams`} variant="secondary">
              View all
            </ButtonLink>
          }
        />
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {recent.map((stream) => (
              <li key={stream.id}>
                <a
                  href={`${base}/live-streaming/streams/${stream.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-raised"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">{stream.title}</span>
                    <span className="block truncate font-mono text-[0.6875rem] text-subtle">{stream.id}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <StreamStatusBadge status={stream.status} />
                    <span className="tabular text-xs text-muted">{formatRelative(stream.createdAt)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}

function StreamStatusBadge({ status }: { status: LiveStreamSummary['status'] }) {
  if (status === 'LIVE') return <Badge tone="live">Live</Badge>;
  if (status === 'ENDED') return <Badge tone="neutral">Ended</Badge>;
  if (status === 'CREATED') return <Badge tone="info">Created</Badge>;
  return <Badge tone="warning">{status.toLowerCase()}</Badge>;
}
