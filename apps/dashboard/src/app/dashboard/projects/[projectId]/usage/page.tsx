import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import {
  AllowanceMeter,
  ChatUsageCard,
  DailyUsageChart,
  ExhaustedNotice,
  LiveStreamingUsageCard,
  UsageHistoryTable,
} from '@/components/usage/usage-panels';
import { formatCount, formatDuration } from '@/lib/format';

/**
 * One project's usage: the minutes it has metered, and the account-level
 * allowance those minutes come out of.
 *
 * The allowance belongs to the project's *owner*, not to whoever is
 * reading this page. For a project you own that distinction is invisible;
 * for one you were added to, it is the only honest way to show the meter —
 * so `ownedByCaller` drives an explicit note rather than presenting
 * someone else's allowance as your own.
 *
 * The live-infrastructure figures below (rooms, participants right now)
 * come from the Control API and the SFU, and are deliberately kept apart
 * from the metered ones: one is a snapshot of what is happening, the other
 * is a durable count of what has happened, and running them together in
 * one row of tiles invites reading a live number as a total.
 */

const HISTORY_LIMIT = 50;
const CHART_DAYS = 30;

export default async function ProjectUsagePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [usageResult, roomsResult] = await Promise.allSettled([
    ravenApi.getProjectUsage(token, projectId, { limit: HISTORY_LIMIT, days: CHART_DAYS }),
    ravenApi.listRooms(token, projectId),
  ]);

  if (usageResult.status === 'rejected') {
    if (usageResult.reason instanceof ApiError && usageResult.reason.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Could not load usage"
        description="The Control API is unreachable right now. Your minutes are unaffected — this page could not read them."
        retryHref={`/dashboard/projects/${projectId}/usage`}
      />
    );
  }

  const { summary, history, daily, ownedByCaller, chat, liveStreaming } = usageResult.value;
  const rooms = roomsResult.status === 'fulfilled' ? roomsResult.value : undefined;

  // liveParticipantCount is null when the SFU could not be reached. That is
  // not the same as an idle room, so it never collapses into a 0.
  const liveDataAvailable = rooms?.every((room) => room.liveParticipantCount !== null) ?? false;
  const liveParticipants = rooms?.reduce((sum, room) => sum + (room.liveParticipantCount ?? 0), 0) ?? 0;
  const roomsInUse = rooms?.filter((room) => (room.liveParticipantCount ?? 0) > 0).length ?? 0;

  const projectSeconds = history.reduce((sum, entry) => sum + entry.meteredSeconds, 0);
  const liveSessionsHere = history.filter((entry) => entry.live).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Project"
        title="Usage"
        description="Livqeno minutes this project has metered, and the account allowance they come out of. Counted server-side by the signaling layer while calls run."
        actions={
          <ButtonLink href="/dashboard/usage" variant="secondary" size="sm">
            Account usage
          </ButtonLink>
        }
      />

      <ExhaustedNotice summary={summary} />

      {!ownedByCaller && (
        <Card>
          <p className="text-sm leading-relaxed text-muted">
            This project is owned by another account, and its sessions spend{' '}
            <strong className="font-medium text-fg">that account&apos;s</strong> allowance rather than yours. The meter
            below is the owner&apos;s — it is the one that decides whether this project can start a new session.
          </p>
        </Card>
      )}

      <section>
        <SectionHeader
          title="This project's metered sessions"
          subtitle={`Across the ${HISTORY_LIMIT} most recent sessions listed below.`}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Sessions"
            value={formatCount(history.length)}
            hint={history.length >= HISTORY_LIMIT ? `Capped at ${HISTORY_LIMIT}` : 'All sessions on record'}
          />
          <StatCard
            label="Metered"
            value={formatCount(Math.floor(projectSeconds / 60))}
            hint={`${formatDuration(projectSeconds * 1000)} of session time`}
          />
          <StatCard label="Metering now" value={formatCount(liveSessionsHere)} hint="Sessions still accruing minutes" />
          <StatCard
            label="Account remaining"
            value={formatCount(summary.remainingMinutes)}
            tone={summary.exhausted ? 'danger' : summary.usedPercent >= 80 ? 'warning' : 'default'}
            hint="Shared across every project this owner has"
          />
        </div>
      </section>

      <AllowanceMeter summary={summary} />

      {(chat || liveStreaming) && (
        <section>
          <SectionHeader
            title="Chat and Live Streaming"
            subtitle="Account-wide allowances, same as RTC above — not filtered to this project. Neither shares a balance with RTC minutes or with each other."
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Absent when the API hasn't been redeployed with these fields yet — an
                older backend serving a newer dashboard build must not crash the page. */}
            {chat && <ChatUsageCard chat={chat} />}
            {liveStreaming && <LiveStreamingUsageCard liveStreaming={liveStreaming} />}
          </div>
        </section>
      )}

      <DailyUsageChart daily={daily} days={CHART_DAYS} />

      <section>
        <SectionHeader title="Session history" subtitle="Every metered session for this project, newest first." />
        <UsageHistoryTable history={history} showProject={false} />
      </section>

      <section>
        <SectionHeader
          title="Live right now"
          subtitle="A snapshot of current infrastructure state, read from the Control API and the SFU. Not a metered total, and not part of the figures above."
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Rooms"
            value={rooms ? formatCount(rooms.length) : <NoDataYet label="Unknown" />}
            hint="All rooms on record for this project"
          />
          <StatCard
            label="Participants"
            value={liveDataAvailable ? formatCount(liveParticipants) : <NoDataYet label="Unknown" />}
            hint={liveDataAvailable ? 'Connected to the SFU right now' : 'The SFU could not be reached'}
          />
          <StatCard
            label="Rooms in use"
            value={liveDataAvailable ? formatCount(roomsInUse) : <NoDataYet label="Unknown" />}
            hint="Rooms with at least one participant"
          />
        </div>
      </section>

      <Card>
        <CardHeader
          title="Not metered"
          subtitle="These are genuinely not counted — the numbers do not exist anywhere to be shown."
        />
        <ul className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm leading-relaxed text-muted sm:grid-cols-2">
          <NotMetered title="TURN relay bandwidth">
            Bytes relayed are not counted or attributed to a project.
          </NotMetered>
          <NotMetered title="Webhooks, storage">Deliveries and attachments consume no allowance.</NotMetered>
          <NotMetered title="Published-track counts over time">
            Only live track state is visible, never a time series.
          </NotMetered>
          <NotMetered title="Cost or billing">
            There is no billing backend, and no price is attached to any of this.
          </NotMetered>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <ButtonLink href={`/dashboard/projects/${projectId}/connections`} variant="secondary" size="sm">
            Connections
          </ButtonLink>
          <ButtonLink href={`/dashboard/projects/${projectId}/rooms`} variant="secondary" size="sm">
            Rooms
          </ButtonLink>
          <ButtonLink href={`/dashboard/projects/${projectId}/metrics`} variant="secondary" size="sm">
            Metrics
          </ButtonLink>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          Connection records are event-sourced from client telemetry and are best-effort, so their durations will not
          match the metered minutes above. Metering reads the server&apos;s own clock and is the authoritative count.
        </p>
      </Card>
    </div>
  );
}

function NotMetered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-subtle" />
      <span className="min-w-0">
        <span className="font-medium text-fg">{title}.</span> {children}
      </span>
    </li>
  );
}
