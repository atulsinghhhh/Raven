import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import { formatCount, formatDuration, normaliseRange, RANGE_LABEL, RANGE_SHORT, RANGES } from '@/lib/format';

type Tab = 'rtc' | 'chat' | 'live';
const TABS: { id: Tab; label: string }[] = [
  { id: 'rtc', label: 'RTC' },
  { id: 'chat', label: 'Chat' },
  { id: 'live', label: 'Live Streaming' },
];

/**
 * A cross-product summary, not a replacement for the per-product pages
 * this wraps. Metrics, Chat overview, and Live Streaming overview each
 * still exist and go deeper. This page answers "how's everything doing"
 * in one range-filtered view before a developer drills into one product.
 * Every number here comes from the same endpoints those pages already
 * call; nothing is bucketed into a time series Livqeno doesn't have.
 */
export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string; tab?: string }>;
}) {
  const { projectId } = await params;
  const { range: rawRange, tab: rawTab } = await searchParams;
  const range = normaliseRange(rawRange);
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : 'rtc';

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  const [metricsResult, chatResult, liveResult] = await Promise.allSettled([
    ravenApi.getMetrics(token, projectId, range),
    ravenApi.getChatOverview(token, projectId, range),
    ravenApi.listLiveStreams(token, projectId),
  ]);

  if (
    metricsResult.status === 'rejected' &&
    metricsResult.reason instanceof ApiError &&
    metricsResult.reason.status === 401
  ) {
    redirect('/login');
  }

  const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : undefined;
  const chat = chatResult.status === 'fulfilled' ? chatResult.value : undefined;
  const liveStreams = liveResult.status === 'fulfilled' ? liveResult.value : undefined;

  const liveNow = liveStreams?.filter((s) => s.status === 'LIVE') ?? [];
  const peakViewers = liveStreams?.reduce((max, s) => Math.max(max, s.peakViewerCount), 0) ?? 0;
  const todayCutoff = new Date().setUTCHours(0, 0, 0, 0);
  const streamsToday = liveStreams?.filter((s) => new Date(s.createdAt).getTime() >= todayCutoff).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="RTC, chat, and live streaming activity for this project, side by side."
        actions={
          <nav
            aria-label="Time range"
            className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5"
          >
            {RANGES.map((r) => (
              <a
                key={r}
                href={`${base}/analytics?tab=${tab}&range=${r}`}
                aria-current={r === range ? 'true' : undefined}
                aria-label={RANGE_LABEL[r]}
                className={`rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
                  r === range ? 'bg-accent-subtle text-accent-text' : 'text-muted hover:bg-surface-raised hover:text-fg'
                }`}
              >
                {RANGE_SHORT[r]}
              </a>
            ))}
            <span
              aria-disabled="true"
              title="Custom date ranges aren't supported by the metrics endpoint yet"
              className="cursor-not-allowed rounded-sm px-2 py-1 text-xs font-medium text-subtle"
            >
              Custom
            </span>
          </nav>
        }
      />

      <nav aria-label="Product" className="flex items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`${base}/analytics?tab=${t.id}&range=${range}`}
            aria-current={t.id === tab ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              t.id === tab ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {tab === 'rtc' &&
        (metrics ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Active rooms" value={formatCount(metrics.activeRooms)} />
              <StatCard label="Active participants" value={formatCount(metrics.activeParticipants)} />
              <StatCard label="Connections" value={formatCount(metrics.connections)} hint={RANGE_LABEL[range]} />
              <StatCard
                label="Avg. duration"
                value={
                  metrics.averageConnectionDurationMs != null ? (
                    formatDuration(metrics.averageConnectionDurationMs)
                  ) : (
                    <NoDataYet label="No completed connections" />
                  )
                }
              />
            </div>
            <ButtonLink href={`${base}/metrics`} variant="secondary" className="self-start">
              Full RTC metrics →
            </ButtonLink>
          </>
        ) : (
          <ErrorState title="RTC metrics unavailable" description="The Control API is unreachable right now." />
        ))}

      {tab === 'chat' &&
        (chat ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Conversations" value={formatCount(chat.conversations)} />
              <StatCard label="Messages sent" value={formatCount(chat.messagesSent)} hint={RANGE_LABEL[range]} />
              <StatCard
                label="Messages failed"
                value={formatCount(chat.messagesFailed)}
                tone={chat.messagesFailed > 0 ? 'warning' : 'default'}
              />
              <StatCard label="Active connections" value={formatCount(chat.activeConnections)} />
            </div>
            <ButtonLink href={`${base}/chat`} variant="secondary" className="self-start">
              Full chat overview →
            </ButtonLink>
          </>
        ) : (
          <ErrorState title="Chat metrics unavailable" description="The Control API is unreachable right now." />
        ))}

      {tab === 'live' &&
        (liveStreams ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Live now"
                value={formatCount(liveNow.length)}
                tone={liveNow.length > 0 ? 'success' : 'default'}
              />
              <StatCard
                label="Peak viewers"
                value={formatCount(peakViewers)}
                hint="Highest recorded for any single stream"
              />
              <StatCard label="Streams today" value={formatCount(streamsToday)} hint="Created since 00:00 UTC" />
              <StatCard label="Total streams" value={formatCount(liveStreams.length)} hint="All time" />
            </div>
            <ButtonLink href={`${base}/live-streaming`} variant="secondary" className="self-start">
              Full live streaming overview →
            </ButtonLink>
          </>
        ) : (
          <ErrorState title="Live streaming data unavailable" description="The Control API is unreachable right now." />
        ))}
    </div>
  );
}
