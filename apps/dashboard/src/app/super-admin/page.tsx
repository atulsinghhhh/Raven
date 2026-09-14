import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { getOverview, type OverviewResponse } from '@/lib/super-admin/overview';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { IconServer } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import { formatCount, formatDateTime, formatDuration } from '@/lib/format';

/**
 * The first screen a Raven operator sees on landing in the console (spec
 * §4/§5). Every number rendered here comes straight off
 * `GET /v1/super-admin/overview`, which itself is nothing but real
 * `count()`/`groupBy()`/`aggregate()` queries — no client-side math beyond
 * unit conversion for display.
 *
 * Read-only for every platform role, so unlike most other super-admin
 * pages there's no permission branch to render here beyond the standard
 * 401/error handling: reaching this page at all means the role check
 * already passed in the layout.
 */
export default async function SuperAdminOverviewPage() {
  // Belt and braces: the layout above already redirects an unauthenticated
  // or non-admin request before this ever renders, but every page in this
  // portal re-checks for itself rather than trusting that alone, same
  // convention as the project audit page.
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin');

  let overview: OverviewResponse;
  try {
    overview = await getOverview(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?next=/super-admin');

    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Overview" description="Platform-wide operations dashboard." />
        <ErrorState
          title="Could not load the overview"
          description="The Control API is unreachable right now. Nothing has been lost — retry in a moment."
          retryHref="/super-admin"
        />
      </div>
    );
  }

  const { developers, projects, rtc, chat, liveStreaming, infrastructure } = overview;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Overview"
        description="Platform-wide counts across developers, projects, RTC, chat and live streaming, refreshed on every load."
        meta={
          <span className="mono-label text-[11px] text-subtle">
            Generated {formatDateTime(overview.generatedAt)}
          </span>
        }
      />

      <section>
        <SectionHeader title="Developers" subtitle="Account counts across the whole platform." />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total" value={formatCount(developers.total)} />
          <StatCard label="New today" value={formatCount(developers.newToday)} />
          <StatCard label="New this week" value={formatCount(developers.newThisWeek)} />
          <StatCard label="Active (30d)" value={formatCount(developers.active)} tone="success" />
          <StatCard label="Inactive" value={formatCount(developers.inactive)} />
          <StatCard
            label="Suspended"
            value={formatCount(developers.suspended)}
            tone={developers.suspended > 0 ? 'danger' : 'default'}
          />
        </div>
      </section>

      <section>
        <SectionHeader title="Projects" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total" value={formatCount(projects.total)} />
          <StatCard label="Active" value={formatCount(projects.active)} tone="success" />
          <StatCard label="New today" value={formatCount(projects.newToday)} />
          <StatCard label="New this week" value={formatCount(projects.newThisWeek)} />
        </div>
      </section>

      <section>
        <SectionHeader
          title="RTC"
          subtitle="Rooms, participants and connection quality across every project."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Active rooms" value={formatCount(rtc.activeRooms)} />
          <StatCard label="Active participants" value={formatCount(rtc.activeParticipants)} />
          <StatCard label="Rooms created today" value={formatCount(rtc.roomsCreatedToday)} />
          <StatCard
            label="Peak concurrent (today)"
            value={
              rtc.peakConcurrentParticipantsToday === null ? (
                <NoDataYet label="No rooms yet" />
              ) : (
                formatCount(rtc.peakConcurrentParticipantsToday)
              )
            }
            hint="Best-effort: largest per-room joined count today"
          />
          <StatCard label="Minutes today" value={formatDuration(rtc.minutesToday * 60_000)} />
          <StatCard label="Minutes this month" value={formatDuration(rtc.minutesThisMonth * 60_000)} />
          <StatCard
            label="Failed connections (today)"
            value={formatCount(rtc.failedConnectionsToday)}
            tone={rtc.failedConnectionsToday > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Reconnect rate (today)"
            value={rtc.reconnectRateToday === null ? <NoDataYet label="No connections yet" /> : formatCount(rtc.reconnectRateToday)}
            hint="Reconnects per connection"
          />
        </div>
      </section>

      <section>
        <SectionHeader title="Chat" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Messages today" value={formatCount(chat.messagesToday)} />
          <StatCard label="Messages this month" value={formatCount(chat.messagesThisMonth)} />
          <StatCard label="Active conversations" value={formatCount(chat.activeConversations)} />
          <StatCard label="Active chat users" value={formatCount(chat.activeChatUsers)} />
          <StatCard
            label="Failed messages (today)"
            value={
              chat.failedMessagesToday === 0 ? (
                <NoDataYet label="None recorded" />
              ) : (
                formatCount(chat.failedMessagesToday)
              )
            }
            hint="Not yet wired into the send path — see plan §4"
            tone={chat.failedMessagesToday > 0 ? 'warning' : 'default'}
          />
        </div>
      </section>

      <section>
        <SectionHeader title="Live streaming" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Active streams" value={formatCount(liveStreaming.activeStreams)} />
          <StatCard label="Streams today" value={formatCount(liveStreaming.streamsToday)} />
          <StatCard
            label="Total viewers (today)"
            value={formatCount(liveStreaming.totalViewersToday)}
            hint="Sum of per-stream peak viewers"
          />
          <StatCard label="Peak viewers (today)" value={formatCount(liveStreaming.peakViewersToday)} />
          <StatCard
            label="Avg duration (today)"
            value={
              liveStreaming.avgStreamDurationMsToday === null ? (
                <NoDataYet label="None ended yet" />
              ) : (
                formatDuration(liveStreaming.avgStreamDurationMsToday)
              )
            }
          />
          <StatCard
            label="Failed streams"
            value={
              liveStreaming.failedStreams === 0 ? (
                <NoDataYet label="None recorded" />
              ) : (
                formatCount(liveStreaming.failedStreams)
              )
            }
            hint="Egress pipeline failures, all-time"
            tone={liveStreaming.failedStreams > 0 ? 'warning' : 'default'}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Infrastructure"
          subtitle="Live dependency probes — the same checks behind /health and project diagnostics."
        />
        <Card>
          <div className="flex flex-wrap gap-2">
            <InfraBadge icon={<IconServer className="size-3.5" />} label="API" status={infrastructure.api} />
            <InfraBadge label="Database" status={infrastructure.database} />
            <InfraBadge label="Redis" status={infrastructure.redis} />
            <InfraBadge label="SFU" status={infrastructure.sfu} />
            <InfraBadge label="TURN" status={infrastructure.turn} />
          </div>
        </Card>
      </section>
    </div>
  );
}

function InfraBadge({
  label,
  status,
  icon,
}: {
  label: string;
  status: 'up' | 'down';
  icon?: React.ReactNode;
}) {
  const tone: BadgeTone = status === 'up' ? 'success' : 'danger';
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      {icon && <span className="text-muted">{icon}</span>}
      <span className="text-xs font-medium text-fg">{label}</span>
      <Badge tone={tone}>{status === 'up' ? 'Healthy' : 'Down'}</Badge>
    </span>
  );
}
