import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { Card, CardHeader, SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import { formatCount, formatDuration } from '@/lib/format';

/**
 * Raven has no usage metering or billing backend. This page therefore
 * shows only what can be *derived* right now from the Control API: room
 * records, live participant counts, and the most recent connection
 * records, and labels every derived number with the window it came from.
 *
 * Nothing here is a bill, a quota, or a bandwidth figure, because none of
 * those exist. The "Not metered yet" section says so directly rather than
 * leaving an empty tile that reads like zero usage.
 */

/** The API caps this at 200 (QueryConnectionsDto): asking for more silently gets you 200. */
const CONNECTION_SAMPLE_LIMIT = 200;

export default async function UsagePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [roomsResult, connectionsResult] = await Promise.allSettled([
    ravenApi.listRooms(token, projectId),
    ravenApi.listConnections(token, projectId, { limit: CONNECTION_SAMPLE_LIMIT }),
  ]);

  if (roomsResult.status === 'rejected') {
    if (roomsResult.reason instanceof ApiError && roomsResult.reason.status === 401) redirect('/login');
    return <ErrorState title="Could not load usage" description="The Control API is unreachable right now." />;
  }

  const rooms = roomsResult.value;
  const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : undefined;

  // liveParticipantCount is null when the SFU couldn't be reached: that is
  // not the same as an idle room, so it never collapses into a 0.
  const liveDataAvailable = rooms.every((r) => r.liveParticipantCount !== null);
  const liveParticipants = rooms.reduce((sum, r) => sum + (r.liveParticipantCount ?? 0), 0);
  const roomsWithLiveParticipants = rooms.filter((r) => (r.liveParticipantCount ?? 0) > 0).length;

  const completed = connections?.filter((c) => c.durationMs !== null) ?? [];
  const totalDurationMs = completed.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  const openConnections = connections?.filter((c) => c.state === 'CONNECTED' || c.state === 'CONNECTING').length;
  const sampleIsCapped = (connections?.length ?? 0) >= CONNECTION_SAMPLE_LIMIT;
  const sampleHint = sampleIsCapped
    ? `From the ${CONNECTION_SAMPLE_LIMIT} most recent connection records`
    : `From all ${formatCount(connections?.length ?? 0)} connection records`;

  const base = `/dashboard/projects/${projectId}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Usage"
        description="What this project is doing right now, derived live from the Control API. Raven does not meter or bill usage yet, so nothing on this page is an invoice or a quota."
      />

      <section>
        <SectionHeader
          title="Live right now"
          subtitle="A snapshot of current infrastructure state, not a historical aggregate."
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Rooms" value={formatCount(rooms.length)} hint="All rooms on record for this project" />
          <StatCard
            label="Participants"
            value={liveDataAvailable ? formatCount(liveParticipants) : <NoDataYet label="Unknown" />}
            hint={liveDataAvailable ? 'Connected to the SFU right now' : 'The SFU could not be reached'}
          />
          <StatCard
            label="Rooms in use"
            value={liveDataAvailable ? formatCount(roomsWithLiveParticipants) : <NoDataYet label="Unknown" />}
            hint="Rooms with at least one participant"
          />
          <StatCard
            label="Open connections"
            value={openConnections !== undefined ? formatCount(openConnections) : <NoDataYet label="Unknown" />}
            hint={openConnections !== undefined ? sampleHint : 'Connection records are unavailable'}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Recent connection activity"
          subtitle={
            connections
              ? `${sampleHint}. Raven stores no rolled-up history, so this is a sample of recent records — not a total for any time period.`
              : 'Connection records are unavailable right now.'
          }
        />
        {connections ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Connections in sample" value={formatCount(connections.length)} hint={sampleHint} />
            <StatCard
              label="Completed connections"
              value={formatCount(completed.length)}
              hint="Records that have a recorded duration"
            />
            <StatCard
              label="Total connection time"
              value={completed.length > 0 ? formatDuration(totalDurationMs) : <NoDataYet label="No completed connections" />}
              hint="Sum of durations across the completed records above"
            />
          </div>
        ) : (
          <Card>
            <NoDataYet label="Connection records could not be loaded" />
          </Card>
        )}
        {connections && sampleIsCapped && (
          <p className="mt-3 text-xs leading-relaxed text-subtle">
            The Control API returns at most {CONNECTION_SAMPLE_LIMIT} connection records per request, and this project
            has hit that ceiling — the figures above describe that sample only, and are not a total for any time period.
          </p>
        )}
      </section>

      <Card>
        <CardHeader
          title="Not metered yet"
          subtitle="Raven has no usage metering, quota, or billing backend. These are genuinely not recorded — the numbers do not exist anywhere to be shown."
        />
        <ul className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm leading-relaxed text-muted sm:grid-cols-2">
          <NotMetered title="Participant-minutes">No historical aggregation of connection duration is stored.</NotMetered>
          <NotMetered title="TURN relay bandwidth">Bytes relayed are not counted or attributed to a project.</NotMetered>
          <NotMetered title="Published-track counts over time">Only live track state is visible, never a time series.</NotMetered>
          <NotMetered title="Per-day or per-month history">Nothing rolls up usage into periods.</NotMetered>
          <NotMetered title="Quotas and rate limits per project">No allowance is defined, so none can be shown.</NotMetered>
          <NotMetered title="Cost or billing">There is no billing backend, and no price is attached to any of the above.</NotMetered>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <ButtonLink href={`${base}/connections`} variant="secondary" size="sm">
            Connections
          </ButtonLink>
          <ButtonLink href={`${base}/rooms`} variant="secondary" size="sm">
            Rooms
          </ButtonLink>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          The closest thing to a trend is the Metrics page&apos;s windowed view (15 minutes to 7 days) — and that is
          computed from these same connection records on request, not from a metering pipeline.
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
