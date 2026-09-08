import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi, type ConnectionLifecycleState, type ConnectionSummary } from '@/lib/api-client';
import { ConnectionStateBadge } from '@/components/ui/badge';
import { SectionHeader, StatCard } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ProductTabs, rtcTabs } from '@/components/shell/product-tabs';
import { DistributionBar } from '@/components/ui/chart';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Dash, EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';
import { MonoId } from '@/components/ui/mono';
import { ButtonLink } from '@/components/ui/button';
import { IconConnections } from '@/components/ui/icons';
import { ConnectionFilters } from './connection-filters';
import { formatCount, formatDuration, formatRelative } from '@/lib/format';

/**
 * The API filters by `state` and `roomId` and caps results at 200
 * (QueryConnectionsDto). Free-text search isn't a server capability, so
 * `q` filters the fetched page in memory, and the UI says so, rather
 * than implying a full-history search.
 */
const SCAN_LIMIT = 200;

const STATES: ConnectionLifecycleState[] = ['CONNECTED', 'CONNECTING', 'RECONNECTING', 'DISCONNECTED', 'FAILED'];

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ state?: string; room?: string; q?: string }>;
}) {
  const { projectId } = await params;
  const { state: rawState, room, q } = await searchParams;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const state = (STATES as string[]).includes(rawState ?? '') ? (rawState as ConnectionLifecycleState) : undefined;

  const [connectionsResult, roomsResult] = await Promise.allSettled([
    ravenApi.listConnections(token, projectId, { state, roomId: room, limit: SCAN_LIMIT }),
    ravenApi.listRooms(token, projectId),
  ]);

  if (connectionsResult.status === 'rejected') {
    const reason = connectionsResult.reason;
    if (reason instanceof ApiError && reason.status === 401) redirect('/login');
    return (
      <ErrorState
        title="Unable to load connections"
        description="The Control API is unreachable right now. Your telemetry is still being recorded."
        requestId={reason instanceof ApiError ? reason.code : undefined}
        retryHref={`/dashboard/projects/${projectId}/connections`}
      />
    );
  }

  const fetched = connectionsResult.value;
  const rooms = roomsResult.status === 'fulfilled' ? roomsResult.value : [];

  const needle = q?.trim().toLowerCase();
  const connections = needle
    ? fetched.filter(
        (c) =>
          c.publicId.toLowerCase().includes(needle) ||
          c.participantIdentity.toLowerCase().includes(needle) ||
          c.roomName.toLowerCase().includes(needle),
      )
    : fetched;

  const base = `/dashboard/projects/${projectId}`;
  const filtered = Boolean(state || room || needle);

  const counts = STATES.map((s) => ({
    label: s.charAt(0) + s.slice(1).toLowerCase(),
    value: connections.filter((c) => c.state === s).length,
    className: STATE_BAR[s],
  }));

  const live = connections.filter((c) => c.state === 'CONNECTED' || c.state === 'RECONNECTING').length;
  const withDuration = connections.filter((c) => c.durationMs !== null);
  const avgDuration =
    withDuration.length > 0
      ? Math.round(withDuration.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) / withDuration.length)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Connections"
        description="Every RTC connection reported by @corvidhq/rtc, newest first."
      />
      <ProductTabs tabs={rtcTabs(base)} active="Connections" />

      {fetched.length === 0 && !filtered ? (
        <EmptyState
          icon={<IconConnections className="size-7" />}
          title="No connections yet"
          description="A connection record appears here the moment a client joins a room with @corvidhq/rtc. Telemetry is automatic — you don't need to instrument anything."
          action={
            <>
              <ButtonLink href={`${base}/quickstart`} variant="primary">
                Open quickstart
              </ButtonLink>
              <ButtonLink href={`${base}/rooms`} variant="secondary">
                View rooms
              </ButtonLink>
            </>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Records shown" value={formatCount(connections.length)} hint={`Most recent ${SCAN_LIMIT} max`} />
            <StatCard label="Currently live" value={formatCount(live)} hint="Connected or reconnecting" />
            <StatCard
              label="Failed"
              value={formatCount(connections.filter((c) => c.state === 'FAILED').length)}
              tone={connections.some((c) => c.state === 'FAILED') ? 'danger' : 'default'}
            />
            <StatCard
              label="Avg. duration"
              value={avgDuration === null ? <NoDataYet label="No completed" /> : formatDuration(avgDuration)}
              hint={`${withDuration.length} completed`}
            />
          </div>

          <section>
            <SectionHeader title="State distribution" subtitle="Across the records shown below." />
            <div className="rounded-lg border border-line bg-surface p-4">
              <DistributionBar segments={counts} caption="Connection states across the records shown" />
            </div>
          </section>

          <ConnectionFilters basePath={`${base}/connections`} rooms={rooms} state={state} room={room} q={q} />

          {connections.length === 0 ? (
            <EmptyState
              title="No connections match these filters"
              description="Try a different state or room, or clear the filters to see everything recorded."
              action={
                <ButtonLink href={`${base}/connections`} variant="secondary">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <>
              <TableWrap className="hidden sm:block">
                <Table>
                  <THead>
                    <TH>Connection</TH>
                    <TH>Room</TH>
                    <TH>Participant</TH>
                    <TH>Status</TH>
                    <TH>Region</TH>
                    <TH align="right">Duration</TH>
                    <TH>SDK</TH>
                    <TH align="right">Started</TH>
                  </THead>
                  <TBody>
                    {connections.map((c) => (
                      <TR key={c.publicId} interactive>
                        <TD className="max-w-[13rem]">
                          <MonoId value={c.publicId} href={`${base}/connections/${c.publicId}`} />
                        </TD>
                        <TD className="max-w-[11rem]">
                          <span className="block truncate text-sm text-fg" title={c.roomName}>
                            {c.roomName}
                          </span>
                        </TD>
                        <TD className="max-w-[11rem]">
                          <span className="block truncate text-sm text-muted" title={c.participantIdentity}>
                            {c.participantIdentity}
                          </span>
                        </TD>
                        <TD>
                          <ConnectionStateBadge state={c.state} />
                        </TD>
                        <TD className="text-sm text-muted">{c.region ?? <Dash />}</TD>
                        <TD align="right" className="tabular text-sm text-muted">
                          {formatDuration(c.durationMs)}
                        </TD>
                        <TD className="text-sm text-muted">
                          {c.sdkVersion ? (
                            <span className="font-mono text-xs">{c.sdkVersion}</span>
                          ) : (
                            <Dash />
                          )}
                        </TD>
                        <TD align="right" className="tabular text-xs text-subtle">
                          <span title={new Date(c.startedAt).toISOString()}>{formatRelative(c.startedAt)}</span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <div className="sm:hidden">
                <MobileList>
                  {connections.map((c) => (
                    <MobileRow key={c.publicId} href={`${base}/connections/${c.publicId}`}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{c.participantIdentity}</span>
                          <span className="block truncate text-xs text-muted">{c.roomName}</span>
                        </span>
                        <ConnectionStateBadge state={c.state} />
                      </div>
                      <div className="mt-3 border-t border-line pt-2">
                        <MobileField label="Connection">
                          <span className="font-mono text-[0.6875rem]">{c.publicId}</span>
                        </MobileField>
                        <MobileField label="Duration">{formatDuration(c.durationMs)}</MobileField>
                        <MobileField label="Started">{formatRelative(c.startedAt)}</MobileField>
                      </div>
                    </MobileRow>
                  ))}
                </MobileList>
              </div>

              <p className="text-xs text-subtle">
                Showing {formatCount(connections.length)} of the {SCAN_LIMIT} most recent connection records.
                {needle && ' Text search filters this page only, not full history.'}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

const STATE_BAR: Record<ConnectionSummary['state'], string> = {
  CONNECTED: 'bg-success',
  CONNECTING: 'bg-warning',
  RECONNECTING: 'bg-warning',
  DISCONNECTED: 'bg-line-strong',
  FAILED: 'bg-danger',
};
